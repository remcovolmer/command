#!/usr/bin/env node
/**
 * Claude Code Hook Script for Command
 *
 * This script receives hook events from Claude Code via stdin (JSON)
 * and writes the session's state to ~/.claude/command-center-state/<session_id>.json,
 * which the Electron app polls. Stale-file cleanup is the watcher's job.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

// Configuration constants
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
const PER_TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])
const POST_TOOL_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure'])

/**
 * Map a raw Claude Code hook event to a Command terminal state.
 * Returns null when the event should not change state.
 *
 * @param {object} data          hook payload
 * @param {object|undefined} current  the session's stored state entry, if any
 */
function mapEventToState(data, current) {
  const state = mapMainEventToState(data)
  // Events fired inside a subagent / in-process teammate carry `agent_id` and
  // share the parent's session_id. Their 'busy' says nothing about the main
  // chat (a background agent keeps calling tools after the main turn's Stop),
  // so only their input requests (permission/question) may change state.
  // Exception: a subagent's PostToolUse(Failure) is the only signal that the
  // permission/question it raised was resolved, so it may clear a stored input
  // state — otherwise the orange dot sticks after the user approves.
  if (state === 'busy' && data.agent_id) {
    const resolvesInput =
      POST_TOOL_EVENTS.has(data.hook_event_name) && !!current && INPUT_STATES.has(current.state)
    return resolvesInput ? state : null
  }
  return state
}

function mapMainEventToState(data) {
  switch (data.hook_event_name) {
    case 'PreToolUse':
      // AskUserQuestion = Claude is asking the user something (orange); any other
      // tool call means Claude is working (gray).
      return data.tool_name === 'AskUserQuestion' ? 'question' : 'busy'
    case 'PostToolUse':
    case 'PostToolUseFailure':
      // The tool ran (or failed) — any permission/question it raised is resolved
      // and Claude continues the turn.
      return 'busy'
    case 'SessionStart':
      // /clear and interactive /resume leave Claude idle at the prompt; startup,
      // compact (mid-turn auto-compact) and fork keep the existing busy default.
      return data.source === 'clear' || data.source === 'resume' ? 'done' : 'busy'
    case 'Stop':
    case 'StopFailure':
      // StopFailure = turn ended by an API error. Claude is still running and
      // back at the prompt waiting for the user, exactly like after Stop, so it
      // is 'done' — 'stopped' means the agent process is gone.
      return 'done'
    case 'SessionEnd':
      // clear/resume: the same CLI continues with a new session (a SessionStart
      // follows). Any other reason means Claude exited — even if the shell lives on.
      return data.reason === 'clear' || data.reason === 'resume' ? 'done' : 'stopped'
    case 'Notification':
      if (data.notification_type === 'permission_prompt') return 'permission'
      // MCP elicitation form/URL dialogs and agents waiting on the user = question.
      if (
        data.notification_type === 'elicitation_dialog' ||
        data.notification_type === 'elicitation_url_dialog' ||
        data.notification_type === 'agent_needs_input'
      ) {
        return 'question'
      }
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

  // 1. Redundant busy from a per-tool-call event — already busy, nothing changes.
  //    Reduces file writes by ~80% during active work (these fire per tool call).
  if (PER_TOOL_EVENTS.has(incoming.hook_event) && incoming.state === 'busy' && cur === 'busy') {
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

// One state file per session in this directory (under ~/.claude). A single shared
// file read-merge-written by concurrent hook processes loses updates: one
// session's write can erase another session's transition. Per-session files have
// exactly one writer stream each, so cross-session races cannot occur.
const STATE_DIR_NAME = 'command-center-state'

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRIES = 4

function stateDirFor(home) {
  return path.join(home, '.claude', STATE_DIR_NAME)
}

/**
 * Build the state entry for one event. `terminal_id` comes from the
 * COMMAND_CENTER_TERMINAL_ID env var that Command injects into every PTY (Claude
 * Code passes its env on to hooks): it is the authoritative session→terminal key
 * for the watcher, so a second session in the same cwd cannot take over a chat.
 */
function buildStateEntry(data, state, env, now) {
  const entry = {
    session_id: data.session_id,
    cwd: data.cwd,
    state: state,
    timestamp: now,
    hook_event: data.hook_event_name,
  }
  const terminalId = env.COMMAND_CENTER_TERMINAL_ID
  if (typeof terminalId === 'string' && UUID_REGEX.test(terminalId)) {
    entry.terminal_id = terminalId
  }
  return entry
}

async function readSessionState(file) {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Unique temp file + rename; retries Windows EPERM/EBUSY while a reader has the target open. */
async function writeFileAtomic(file, content) {
  const tempFile = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.promises.writeFile(tempFile, content)
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tempFile, file)
      return
    } catch (e) {
      if (attempt < RENAME_RETRIES && e && RENAME_RETRY_CODES.has(e.code)) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
        continue
      }
      try {
        await fs.promises.unlink(tempFile)
      } catch {
        /* best-effort temp cleanup */
      }
      throw e
    }
  }
}

/**
 * Map one hook payload to a state and persist it to the session's own file.
 * Returns 'ignored' (no state change / invalid), 'skipped' (guarded) or 'written'.
 */
async function recordState(stateDir, data, env, now = Date.now) {
  // Validate session_id format: it becomes a file name (no path traversal).
  if (!data || typeof data.session_id !== 'string' || !UUID_REGEX.test(data.session_id)) {
    return 'ignored'
  }
  const file = path.join(stateDir, `${data.session_id}.json`)
  // The stored state is needed to map subagent post-tool events (see mapEventToState).
  const current = await readSessionState(file)
  const state = mapEventToState(data, current)
  if (!state) return 'ignored'

  const entry = buildStateEntry(data, state, env, now())

  // Early skip using the state read at entry (redundant busy / protected input state).
  if (shouldSkipWrite(current, entry, now())) return 'skipped'

  // For downgrade writes (busy/done) re-read immediately before writing. This catches
  // an input state (question/permission) that ANOTHER hook process of this session
  // wrote after our first read (AskUserQuestion fires several events at once).
  if (state === 'busy' || state === 'done') {
    const latest = await readSessionState(file)
    // A subagent busy is only allowed while an input state is stored; re-check so a
    // 'done' written in between is not overwritten by subagent noise.
    if (!mapEventToState(data, latest)) return 'skipped'
    if (shouldSkipWrite(latest, entry, now())) return 'skipped'
  }

  await fs.promises.mkdir(stateDir, { recursive: true })
  await writeFileAtomic(file, JSON.stringify(entry))
  return 'written'
}

module.exports = {
  mapEventToState,
  shouldSkipWrite,
  buildStateEntry,
  recordState,
  stateDirFor,
  INPUT_STATE_GUARD_MS,
}

// Only wire up stdin when executed directly by Claude Code (not when required by tests).
if (require.main === module) {
  let input = ''
  process.stdin.on('data', (chunk) => (input += chunk))
  process.stdin.on('end', async () => {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
      await recordState(stateDirFor(home), JSON.parse(input), process.env)
    } catch {
      // Silent fail - don't interfere with Claude Code
    }

    // Ensure prompt exit — avoids lingering process blocking Claude Code
    process.exit(0)
  })
}
