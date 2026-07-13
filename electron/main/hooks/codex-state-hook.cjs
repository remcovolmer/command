#!/usr/bin/env node
/**
 * Codex CLI Hook Script for Command
 *
 * Codex fires lifecycle hooks (configured in ~/.codex/hooks.json by HookInstaller)
 * that run this script with one JSON object on stdin, exactly like Claude Code.
 * It maps the event to a Command terminal state and writes to the SAME shared
 * state file the Claude hook uses (~/.claude/command-center-state.json), keyed by
 * session_id. ClaudeHookWatcher polls that file and is agent-agnostic — it does
 * not care which agent produced an entry.
 *
 * Kept self-contained (no cross-require of claude-state-hook.cjs): a standalone
 * hook must not break because a sibling script changed.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const STALE_SESSION_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// How long a freshly-surfaced input state (permission) is protected from being
// downgraded to 'busy' by a racing near-simultaneous hook write. Codex fires a
// PermissionRequest for approvals; async hook startup variance can otherwise let
// a surrounding 'busy' land after it and erase the orange dot before the user acts.
const INPUT_STATE_GUARD_MS = 2500

const INPUT_STATES = new Set(['question', 'permission'])

/**
 * Map a raw Codex hook event to a Command terminal state.
 * Returns null when the event should not change state.
 *
 * Codex has no AskUserQuestion tool (that is Claude-specific), so 'question'
 * never fires for codex — approvals surface as 'permission' via PermissionRequest.
 */
function mapEventToState(data) {
  switch (data.hook_event_name) {
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PreToolUse':
      return 'busy'
    case 'PermissionRequest':
      return 'permission'
    case 'Stop':
      return 'done'
    default:
      return null
  }
}

/**
 * Decide whether an incoming state write should be SKIPPED given the session's
 * current on-disk state. Pure function — exported for unit testing.
 */
function shouldSkipWrite(current, incoming, now, guardMs = INPUT_STATE_GUARD_MS) {
  if (!current) return false
  const cur = current.state

  // Redundant busy from PreToolUse — already busy, nothing changes.
  if (incoming.hook_event === 'PreToolUse' && incoming.state === 'busy' && cur === 'busy') {
    return true
  }

  // Protect a freshly-surfaced input state from being clobbered by a racing 'busy'.
  if (INPUT_STATES.has(cur)) {
    const age = now - (current.timestamp || 0)
    if (incoming.state === 'busy' && age < guardMs) {
      return true
    }
  }

  return false
}

module.exports = { mapEventToState, shouldSkipWrite, INPUT_STATE_GUARD_MS }

// Only wire up stdin when executed directly by Codex (not when required by tests).
if (require.main === module) {
  let input = ''
  process.stdin.on('data', (chunk) => (input += chunk))
  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(input)

      // Validate session_id format to prevent prototype pollution. Codex session
      // ids are UUIDs.
      if (!data.session_id || !UUID_REGEX.test(data.session_id)) {
        process.exit(0)
      }

      // Shared state file — the same one the Claude hook and the watcher use.
      const stateFile = path.join(
        process.env.HOME || process.env.USERPROFILE || os.homedir(),
        '.claude',
        'command-center-state.json'
      )

      const state = mapEventToState(data)
      if (!state) {
        process.exit(0)
      }
      const hookEvent = data.hook_event_name

      const stateData = {
        session_id: data.session_id,
        cwd: data.cwd,
        state: state,
        timestamp: Date.now(),
        hook_event: hookEvent,
      }

      const readStates = async () => {
        let all = Object.create(null)
        try {
          const existing = await fs.promises.readFile(stateFile, 'utf-8')
          all = Object.assign(Object.create(null), JSON.parse(existing))
        } catch (e) {
          // Start fresh if file doesn't exist or is invalid
        }
        return all
      }

      let allStates = await readStates()

      if (shouldSkipWrite(allStates[data.session_id], stateData, Date.now())) {
        process.exit(0)
      }

      // For downgrade writes (busy/done) re-read immediately before writing to
      // catch an input state another hook process wrote after our first read.
      if (state === 'busy' || state === 'done') {
        const fresh = await readStates()
        if (shouldSkipWrite(fresh[data.session_id], stateData, Date.now())) {
          process.exit(0)
        }
        allStates = fresh
      }

      allStates[data.session_id] = stateData

      const now = Date.now()
      for (const sid in allStates) {
        if (allStates[sid].timestamp && now - allStates[sid].timestamp > STALE_SESSION_TIMEOUT_MS) {
          delete allStates[sid]
        }
      }

      const tempFile = stateFile + '.tmp.' + process.pid
      try {
        await fs.promises.writeFile(tempFile, JSON.stringify(allStates))
        await fs.promises.rename(tempFile, stateFile)
      } catch (writeErr) {
        try {
          await fs.promises.unlink(tempFile)
        } catch {
          /* best-effort temp cleanup */
        }
      }
    } catch (e) {
      // Silent fail — never interfere with Codex.
    }

    process.exit(0)
  })
}
