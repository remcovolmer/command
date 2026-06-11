#!/usr/bin/env node
/**
 * Claude Code Hook Script for Command
 *
 * This script receives hook events from Claude Code via stdin (JSON)
 * and writes the state to a file that the Electron app watches.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

// Configuration constants
const STALE_SESSION_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// How long a freshly-surfaced input state (question/permission) is protected from being
// downgraded to 'busy' by a racing or near-simultaneous hook write.
//
// Why this is needed: AskUserQuestion fires THREE events in rapid succession
// (PreToolUse->question, PermissionRequest->permission ~8ms later, and a delayed
// Notification(permission_prompt)->permission ~6s later). Hooks run with async:true, so
// node-process startup variance (~150-300ms on Windows, larger than the 250ms watcher
// poll) means a surrounding 'busy' write can land AFTER the input-state write and erase
// the orange attention dot before the user ever sees it. The window covers that variance
// plus several poll cycles; a genuine "Claude resumed" busy fires only after the user
// answers (typically well beyond this window) and so still clears the dot.
const INPUT_STATE_GUARD_MS = 2500

const INPUT_STATES = new Set(['question', 'permission'])

/**
 * Map a raw Claude Code hook event to a Command terminal state.
 * Returns null when the event should not change state.
 */
function mapEventToState(data) {
  switch (data.hook_event_name) {
    case 'PreToolUse':
      // AskUserQuestion = Claude is asking the user something (orange); any other
      // tool call means Claude is working (gray).
      return data.tool_name === 'AskUserQuestion' ? 'question' : 'busy'
    case 'SessionStart':
      return 'busy'
    case 'Stop':
    case 'SessionEnd':
      return 'done'
    case 'Notification':
      if (data.notification_type === 'permission_prompt') return 'permission'
      // Claude waiting 60+ seconds for user input = done (green).
      if (data.notification_type === 'idle_prompt') return 'done'
      // auth_success and other types don't change state.
      return null
    case 'UserPromptSubmit':
      return 'busy'
    case 'PermissionRequest':
      return 'permission'
    default:
      return null
  }
}

/**
 * Decide whether an incoming state write should be SKIPPED given the session's current
 * on-disk state. Pure function — exported for unit testing.
 *
 * @param {object|undefined} current  current stored state for this session
 * @param {object} incoming           { state, hook_event, timestamp, ... } about to be written
 * @param {number} now                Date.now()
 * @param {number} guardMs            input-state protection window
 * @returns {boolean} true to skip the write
 */
function shouldSkipWrite(current, incoming, now, guardMs = INPUT_STATE_GUARD_MS) {
  if (!current) return false
  const cur = current.state

  // 1. Redundant busy from PreToolUse — already busy, nothing changes.
  //    Reduces file writes by ~80% during active work (PreToolUse fires per tool call).
  if (incoming.hook_event === 'PreToolUse' && incoming.state === 'busy' && cur === 'busy') {
    return true
  }

  // 2. Protect a freshly-surfaced input state from being clobbered.
  if (INPUT_STATES.has(cur)) {
    const age = now - (current.timestamp || 0)
    // A 'busy' write inside the guard window is a race partner of the input state,
    // not a genuine resume — skip it so the orange dot survives until the user acts.
    if (incoming.state === 'busy' && age < guardMs) {
      return true
    }
    // An idle 'done' (Notification) while an input state is pending is wrong by
    // definition: the user hasn't acted, so the question/permission still stands.
    // (A real Stop/SessionEnd 'done' is allowed through and clears the dot.)
    if (incoming.state === 'done' && incoming.hook_event === 'Notification') {
      return true
    }
  }

  return false
}

module.exports = { mapEventToState, shouldSkipWrite, INPUT_STATE_GUARD_MS }

// Only wire up stdin when executed directly by Claude Code (not when required by tests).
if (require.main === module) {
  let input = ''
  process.stdin.on('data', (chunk) => (input += chunk))
  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(input)

      // Validate session_id format to prevent prototype pollution
      if (!data.session_id || !UUID_REGEX.test(data.session_id)) {
        process.exit(0) // Invalid session ID, skip
      }

      const stateFile = path.join(
        process.env.HOME || process.env.USERPROFILE || os.homedir(),
        '.claude',
        'command-center-state.json'
      )

      const state = mapEventToState(data)
      if (!state) {
        process.exit(0) // Event doesn't change state
      }
      const hookEvent = data.hook_event_name

      const stateData = {
        session_id: data.session_id,
        cwd: data.cwd,
        state: state,
        timestamp: Date.now(),
        hook_event: hookEvent,
      }

      // Read-merge-write pattern for multi-session support.
      // Use Object.create(null) to prevent prototype pollution.
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

      // Early skip using the state read at entry (redundant busy / protected input state).
      if (shouldSkipWrite(allStates[data.session_id], stateData, Date.now())) {
        process.exit(0)
      }

      // For downgrade writes (busy/done) re-read immediately before writing. This catches
      // an input state (question/permission) that ANOTHER hook process wrote AFTER our
      // first read — the actual async write-order race that silently erased the orange dot.
      if (state === 'busy' || state === 'done') {
        const fresh = await readStates()
        if (shouldSkipWrite(fresh[data.session_id], stateData, Date.now())) {
          process.exit(0)
        }
        allStates = fresh
      }

      // Write this session's state keyed by session_id
      allStates[data.session_id] = stateData

      // Cleanup stale sessions
      const now = Date.now()
      for (const sid in allStates) {
        if (allStates[sid].timestamp && now - allStates[sid].timestamp > STALE_SESSION_TIMEOUT_MS) {
          delete allStates[sid]
        }
      }

      // Atomic write: temp file + rename to avoid TOCTOU race conditions
      const tempFile = stateFile + '.tmp.' + process.pid
      try {
        await fs.promises.writeFile(tempFile, JSON.stringify(allStates))
        await fs.promises.rename(tempFile, stateFile)
      } catch (writeErr) {
        // Cleanup temp file on error
        try {
          await fs.promises.unlink(tempFile)
        } catch {
          /* best-effort temp cleanup */
        }
      }
    } catch (e) {
      // Silent fail - don't interfere with Claude Code
    }

    // Ensure prompt exit — avoids lingering process blocking Claude Code
    process.exit(0)
  })
}
