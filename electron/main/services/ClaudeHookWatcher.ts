import { watchFile, unwatchFile, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { homedir } from 'os'
import type { TerminalState } from '../../../src/types'
import { isValidTerminalState } from '../../../src/types'
import { normalizePath } from '../utils/paths'

// Configuration constants
const POLL_INTERVAL_MS = 100
const MAX_PENDING_QUEUE_SIZE = 10

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL

interface HookStateData {
  session_id: string
  cwd: string
  state: TerminalState
  timestamp: number
  hook_event: string
}

// Multi-session state file format: { [session_id]: HookStateData }
type MultiSessionState = Record<string, HookStateData>

/**
 * Type guard to validate HookStateData shape at runtime
 * Prevents crashes from malformed external JSON data
 */
function isHookStateData(value: unknown): value is HookStateData {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.session_id === 'string' &&
    typeof obj.state === 'string' &&
    typeof obj.timestamp === 'number' &&
    typeof obj.hook_event === 'string'
    // Note: cwd can be undefined
  )
}

export class ClaudeHookWatcher {
  private watching: boolean = false
  private stateFilePath: string
  private window: BrowserWindow

  // Session ID matching: session_id → terminal_id
  private sessionToTerminal: Map<string, string> = new Map()
  // Multiple terminals can share same cwd (e.g., split terminals)
  private cwdToTerminals: Map<string, Set<string>> = new Map()

  // Per-session timestamp tracking for deduplication
  private lastProcessedTimestamps: Map<string, number> = new Map()

  // Queue for states arriving before terminal is registered
  private pendingStates: Map<string, HookStateData[]> = new Map()

  constructor(window: BrowserWindow) {
    this.window = window
    const claudeDir = join(homedir(), '.claude')
    this.stateFilePath = join(claudeDir, 'command-center-state.json')

    // Ensure .claude directory exists
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true })
    }
  }

  start(): void {
    // Create empty state file if it doesn't exist
    if (!existsSync(this.stateFilePath)) {
      writeFileSync(this.stateFilePath, '{}')
    }

    // Poll for file changes (fs.watch is unreliable on Windows)
    watchFile(this.stateFilePath, { interval: POLL_INTERVAL_MS }, () => {
      this.onStateChange()
    })
    this.watching = true

    console.log('[HookWatcher] Started watching:', this.stateFilePath)
  }

  /**
   * Register a terminal for a working directory
   */
  registerTerminal(terminalId: string, cwd: string): void {
    const normalizedCwd = normalizePath(cwd)

    // Add terminal to the Set for this cwd
    let terminals = this.cwdToTerminals.get(normalizedCwd)
    if (!terminals) {
      terminals = new Set()
      this.cwdToTerminals.set(normalizedCwd, terminals)
    }
    terminals.add(terminalId)

    if (isDev) {
      console.log(`[HookWatcher] Registered terminal ${terminalId} for cwd: ${normalizedCwd}`)
      console.log(`[HookWatcher]   Terminals in this cwd: ${Array.from(terminals).join(', ')}`)
    }

    // Process any pending states for this cwd
    const pending = this.pendingStates.get(normalizedCwd)
    if (pending && pending.length > 0) {
      if (isDev) {
        console.log(`[HookWatcher] Processing ${pending.length} pending states for cwd: ${normalizedCwd}`)
      }
      for (const state of pending) {
        this.processStateForTerminal(state, terminalId)
      }
      this.pendingStates.delete(normalizedCwd)
    }
  }

  /**
   * Unregister terminal and cleanup all mappings
   */
  unregisterTerminal(terminalId: string): void {
    // Remove from cwd mapping
    for (const [cwd, terminals] of this.cwdToTerminals) {
      if (terminals.has(terminalId)) {
        terminals.delete(terminalId)
        if (isDev) {
          console.log(`[HookWatcher] Unregistered terminal ${terminalId} from cwd: ${cwd}`)
        }
        // Cleanup empty Sets
        if (terminals.size === 0) {
          this.cwdToTerminals.delete(cwd)
        }
        break
      }
    }

    // Remove from session mapping and cleanup timestamp tracking
    for (const [sessionId, tid] of this.sessionToTerminal) {
      if (tid === terminalId) {
        this.sessionToTerminal.delete(sessionId)
        this.lastProcessedTimestamps.delete(sessionId)
        if (isDev) {
          console.log(`[HookWatcher] Unregistered session ${sessionId} for terminal ${terminalId}`)
        }
        break
      }
    }
  }

  private onStateChange(): void {
    try {
      const content = readFileSync(this.stateFilePath, 'utf-8')
      const parsed = JSON.parse(content)

      // Handle both legacy single-session and new multi-session format
      const allStates: MultiSessionState = this.normalizeStateFile(parsed)

      // Process each session's state
      for (const sessionId in allStates) {
        const hookState = allStates[sessionId]
        this.processSessionState(hookState)
      }
    } catch (e) {
      // Ignore parse errors (file might be mid-write)
    }
  }

  /**
   * Normalize state file to multi-session format (handles legacy single-session)
   */
  private normalizeStateFile(parsed: unknown): MultiSessionState {
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    const obj = parsed as Record<string, unknown>

    // Check if this is legacy single-session format
    if (isHookStateData(obj)) {
      return { [obj.session_id]: obj }
    }

    // Multi-session format: validate each entry
    const result: MultiSessionState = {}
    for (const [key, value] of Object.entries(obj)) {
      if (isHookStateData(value)) {
        result[key] = value
      }
    }
    return result
  }

  /**
   * Process a single session's state update
   */
  private processSessionState(hookState: HookStateData): void {
    const sessionId = hookState.session_id
    if (!sessionId) return

    // Skip if we've already processed this timestamp for this session
    // Use strict less-than to allow same-millisecond events (sub-millisecond timing edge case)
    const lastTimestamp = this.lastProcessedTimestamps.get(sessionId) || 0
    if (hookState.timestamp < lastTimestamp) {
      return  // Only skip if timestamp is older (not equal)
    }
    this.lastProcessedTimestamps.set(sessionId, hookState.timestamp)

    const normalizedCwd = hookState.cwd ? normalizePath(hookState.cwd) : undefined

    if (isDev) {
      console.log(`[HookWatcher] State change: ${hookState.hook_event} -> ${hookState.state}`)
      console.log(`[HookWatcher]   session: ${sessionId}, cwd: ${normalizedCwd}`)
    }

    // Try to find terminal for this session
    let terminalId = this.sessionToTerminal.get(sessionId)

    // On SessionStart: try to associate with an unassigned terminal in this cwd
    if (hookState.hook_event === 'SessionStart' && normalizedCwd && !terminalId) {
      terminalId = this.associateSessionWithTerminal(sessionId, normalizedCwd)
    }

    // Fallback: find any terminal in this cwd that doesn't have a session yet
    if (!terminalId && normalizedCwd) {
      terminalId = this.findUnassignedTerminalInCwd(normalizedCwd)
      if (terminalId) {
        // Associate this session with the found terminal
        this.removeOldSessionForTerminal(terminalId)
        this.sessionToTerminal.set(sessionId, terminalId)
        if (isDev) {
          console.log(`[HookWatcher] Late association: session ${sessionId} with terminal ${terminalId}`)
        }
      }
    }

    if (terminalId) {
      this.processStateForTerminal(hookState, terminalId)
    } else if (normalizedCwd) {
      // Queue state for when terminal registers
      this.queuePendingState(normalizedCwd, hookState)
    } else if (isDev) {
      console.log(`[HookWatcher] No matching terminal found for session ${sessionId}`)
    }

    // On SessionEnd: cleanup session mapping
    if (hookState.hook_event === 'SessionEnd') {
      this.sessionToTerminal.delete(sessionId)
      this.lastProcessedTimestamps.delete(sessionId)
    }
  }

  /**
   * Associate a new session with an unassigned terminal in the same cwd
   */
  private associateSessionWithTerminal(sessionId: string, normalizedCwd: string): string | undefined {
    const terminalId = this.findUnassignedTerminalInCwd(normalizedCwd)

    if (terminalId) {
      // Remove any old session mapping for this terminal
      this.removeOldSessionForTerminal(terminalId)

      // Associate new session with terminal
      this.sessionToTerminal.set(sessionId, terminalId)
      if (isDev) {
        console.log(`[HookWatcher] Associated session ${sessionId} with terminal ${terminalId}`)
      }
    }

    return terminalId
  }

  /**
   * Find a terminal in the given cwd that doesn't have a session assigned yet
   */
  private findUnassignedTerminalInCwd(normalizedCwd: string): string | undefined {
    const terminals = this.cwdToTerminals.get(normalizedCwd)
    if (!terminals || terminals.size === 0) {
      return undefined
    }

    // Get set of terminals that already have sessions
    const assignedTerminals = new Set(this.sessionToTerminal.values())

    // Find first unassigned terminal
    for (const terminalId of terminals) {
      if (!assignedTerminals.has(terminalId)) {
        return terminalId
      }
    }

    // All terminals have sessions - log warning and return first one
    if (isDev) {
      console.warn(`[HookWatcher] All terminals in cwd "${normalizedCwd}" already have sessions. Using first terminal.`)
    }
    const first = terminals.values().next()
    return first.done ? undefined : first.value
  }

  /**
   * Remove old session mapping for a terminal (when reassigning to new session)
   */
  private removeOldSessionForTerminal(terminalId: string): void {
    for (const [oldSessionId, tid] of this.sessionToTerminal) {
      if (tid === terminalId) {
        this.sessionToTerminal.delete(oldSessionId)
        this.lastProcessedTimestamps.delete(oldSessionId)
        if (isDev) {
          console.log(`[HookWatcher] Removed old session ${oldSessionId} for terminal ${terminalId}`)
        }
        break
      }
    }
  }

  /**
   * Queue a state update for a cwd that doesn't have a terminal yet
   */
  private queuePendingState(normalizedCwd: string, hookState: HookStateData): void {
    let pending = this.pendingStates.get(normalizedCwd)
    if (!pending) {
      pending = []
      this.pendingStates.set(normalizedCwd, pending)
    }

    // Limit queue size to prevent memory issues
    if (pending.length >= MAX_PENDING_QUEUE_SIZE) {
      pending.shift()
    }
    pending.push(hookState)

    if (isDev) {
      console.log(`[HookWatcher] Queued pending state for cwd: ${normalizedCwd} (queue size: ${pending.length})`)
    }
  }

  /**
   * Process a state and emit to renderer
   */
  private processStateForTerminal(hookState: HookStateData, terminalId: string): void {
    // Validate state before emitting
    if (!isValidTerminalState(hookState.state)) {
      if (isDev) {
        console.warn(`[HookWatcher] Invalid state "${hookState.state}" for terminal ${terminalId}`)
      }
      return
    }
    console.log(`[HookWatcher] Emitting state ${hookState.state} for terminal ${terminalId}`)
    this.sendToRenderer('terminal:state', terminalId, hookState.state)
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  stop(): void {
    if (this.watching) {
      unwatchFile(this.stateFilePath)
      this.watching = false
      console.log('[HookWatcher] Stopped watching')
    }
  }
}
