/**
 * command-center-state-plugin — managed by Command; safe to delete, do not edit by hand.
 *
 * OpenCode state plugin for Command (https://github.com/remcovolmer/command).
 *
 * OpenCode has no hooks.json equivalent: state arrives via this plugin, dropped
 * into ~/.config/opencode/plugins/ by Command's HookInstaller. It maps session
 * and permission events to a Command terminal state and writes to the SAME
 * shared state file the Claude/Codex hooks use
 * (~/.claude/command-center-state.json), keyed by session_id. ClaudeHookWatcher
 * polls that file and is agent-agnostic — it does not care which agent produced
 * an entry.
 *
 * Event shapes verified live against opencode 1.18.29 (see
 * docs/solutions/integration-issues/opencode-cli-plugin-spikes-s0-s4.md).
 * Payload reads are defensive across SDK generations: sessionID may live at
 * properties.sessionID (v1 bus) or properties.info.id, and permission hooks
 * carry input.sessionID directly.
 *
 * Kept dependency-free (node: builtins only — no npm install needed) and
 * silent-failing: a state write must never break the agent run. File I/O is
 * deliberately SYNCHRONOUS: `opencode run` can exit before pending promises
 * flush, which silently drops async writes (verified live — async version
 * wrote nothing, sync version works).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const STALE_SESSION_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour

// How long a freshly-surfaced input state (permission) is protected from being
// downgraded to 'busy' by a racing near-simultaneous event write. Async plugin
// delivery can otherwise let a surrounding 'busy' land after it and erase the
// orange dot before the user acts.
const INPUT_STATE_GUARD_MS = 2500

const INPUT_STATES = new Set(['question', 'permission'])

// session_id -> last seen working directory (hook slots carry no cwd, so the
// bus events populate this cache; falls back to '' when unknown — the watcher
// matches on session_id first and tolerates a missing cwd).
const sessionDirectories = new Map()

function stateFilePath() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
  return path.join(home, '.claude', 'command-center-state.json')
}

/**
 * Map an OpenCode bus event to a Command terminal state.
 * Returns null when the event should not change state.
 *
 * opencode has no AskUserQuestion equivalent surfacing here, so 'question'
 * never fires — approvals surface as 'permission'. session.error means the
 * run failed but the session is still alive and waiting for the user, hence
 * 'done' (same attention semantics as a finished run).
 */
function mapEventToState(event) {
  switch (event?.type) {
    case 'session.created':
    case 'session.updated':
      return 'busy'
    case 'session.status':
      return event?.properties?.status?.type === 'idle' ? 'done' : 'busy'
    case 'permission.asked':
      return 'permission'
    case 'session.idle':
    case 'session.error':
      return 'done'
    default:
      return null
  }
}

/**
 * Extract the Command session id and cwd from a bus event, tolerating both
 * the v1 shape (properties.sessionID) and variants nesting the id under
 * properties.info.
 */
function extractSession(event) {
  const props = event?.properties ?? {}
  const info = props.info ?? {}
  return {
    sessionId: props.sessionID ?? info.id ?? null,
    cwd: info.directory ?? null,
  }
}

/**
 * Decide whether an incoming state write should be SKIPPED given the session's
 * current on-disk state. Pure function — exported for unit testing.
 */
function shouldSkipWrite(current, incoming, now, guardMs = INPUT_STATE_GUARD_MS) {
  if (!current) return false
  const cur = current.state

  // Redundant busy from a tool call — already busy, nothing changes.
  if (incoming.hook_event === 'tool.execute.before' && incoming.state === 'busy' && cur === 'busy') {
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

async function readStates(stateFile) {
  let all = Object.create(null)
  try {
    const existing = fs.readFileSync(stateFile, 'utf-8')
    all = Object.assign(Object.create(null), JSON.parse(existing))
  } catch {
    // Start fresh if file doesn't exist or is invalid
  }
  return all
}

async function writeState(sessionId, cwd, state, hookEvent) {
  const stateFile = stateFilePath()
  const stateData = {
    session_id: sessionId,
    cwd: cwd ?? '',
    state,
    timestamp: Date.now(),
    hook_event: hookEvent,
  }

  let allStates = await readStates(stateFile)
  if (shouldSkipWrite(allStates[sessionId], stateData, Date.now())) {
    return
  }

  // For downgrade writes (busy/done) re-read immediately before writing to
  // catch an input state another plugin invocation wrote after our first read.
  if (state === 'busy' || state === 'done') {
    const fresh = await readStates(stateFile)
    if (shouldSkipWrite(fresh[sessionId], stateData, Date.now())) {
      return
    }
    allStates = fresh
  }

  allStates[sessionId] = stateData

  const now = Date.now()
  for (const sid in allStates) {
    if (allStates[sid].timestamp && now - allStates[sid].timestamp > STALE_SESSION_TIMEOUT_MS) {
      delete allStates[sid]
    }
  }

  const tempFile = stateFile + '.tmp.' + process.pid
  try {
    // ~/.claude may not exist on opencode-only machines — ensure it first.
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(tempFile, JSON.stringify(allStates))
    fs.renameSync(tempFile, stateFile)
  } catch {
    try {
      fs.unlinkSync(tempFile)
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

async function handleBusEvent(event) {
  const { sessionId, cwd } = extractSession(event)
  if (!sessionId) {
    return
  }
  if (cwd) {
    sessionDirectories.set(sessionId, cwd)
  }
  const state = mapEventToState(event)
  if (!state) {
    return
  }
  const hookEvent = event?.type ?? 'unknown'
  await writeState(sessionId, cwd ?? sessionDirectories.get(sessionId), state, hookEvent)
}

async function handleHookSlot(sessionId, state, hookEvent) {
  if (!sessionId) {
    return
  }
  await writeState(sessionId, sessionDirectories.get(sessionId), state, hookEvent)
}

/**
 * The plugin entrypoint opencode loads. Subscribes to the event bus (session
 * lifecycle) plus the tool/permission hook slots (per-tool busy, approvals).
 * Every handler is silent-failing — state reporting must never break the run.
 */
export const CommandCenterState = async () => {
  return {
    event: async ({ event }) => {
      try {
        await handleBusEvent(event)
      } catch {
        /* silent — never interfere with opencode */
      }
    },
    'tool.execute.before': async (input) => {
      try {
        await handleHookSlot(input?.sessionID, 'busy', 'tool.execute.before')
      } catch {
        /* silent */
      }
    },
    'permission.ask': async (input) => {
      try {
        await handleHookSlot(input?.sessionID, 'permission', 'permission.ask')
      } catch {
        /* silent */
      }
    },
  }
}

// Pure helpers attached for unit testing — deliberately NOT module exports:
// opencode requires every plugin export to be a function and refuses to load
// the file otherwise ("Plugin export is not a function", verified live).
CommandCenterState.mapEventToState = mapEventToState
CommandCenterState.extractSession = extractSession
CommandCenterState.shouldSkipWrite = shouldSkipWrite
CommandCenterState.INPUT_STATE_GUARD_MS = INPUT_STATE_GUARD_MS
