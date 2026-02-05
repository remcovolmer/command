import { watchFile, unwatchFile, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { homedir } from 'os'
import type { TerminalState } from '../../../src/types'
import { normalizePath } from '../utils/paths'

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL

interface HookStateData {
  session_id: string
  cwd: string
  state: TerminalState
  timestamp: number
  hook_event: string
}

export class ClaudeHookWatcher {
  private watching: boolean = false
  private stateFilePath: string
  private window: BrowserWindow

  // Session ID matching: session_id → terminal_id
  private sessionToTerminal: Map<string, string> = new Map()
  // Reverse lookup: terminal_id → session_id (for persistence on close)
  private terminalToSession: Map<string, string> = new Map()
  // Persistent cwd → terminal_id mapping (survives session restarts)
  private cwdToTerminal: Map<string, string> = new Map()

  // Deduplicate file change events
  private lastProcessedTimestamp: number = 0

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
    watchFile(this.stateFilePath, { interval: 100 }, () => {
      this.onStateChange()
    })
    this.watching = true

    console.log('[HookWatcher] Started watching:', this.stateFilePath)
  }

  /**
   * Register a terminal for a working directory
   */
  registerTerminal(terminalId: string, cwd: string): void {
    // Normalize path for comparison
    const normalizedCwd = normalizePath(cwd)
    this.cwdToTerminal.set(normalizedCwd, terminalId)
    if (isDev) {
      console.log(`[HookWatcher] Registered terminal ${terminalId} for cwd: ${normalizedCwd}`)
    }
  }

  /**
   * Unregister terminal and cleanup all mappings
   */
  unregisterTerminal(terminalId: string): void {
    // Remove from cwd mapping
    for (const [cwd, tid] of this.cwdToTerminal) {
      if (tid === terminalId) {
        this.cwdToTerminal.delete(cwd)
        if (isDev) {
          console.log(`[HookWatcher] Unregistered terminal ${terminalId} from cwd: ${cwd}`)
        }
        break
      }
    }
    // Remove from session mapping (both directions)
    const sessionId = this.terminalToSession.get(terminalId)
    if (sessionId) {
      this.sessionToTerminal.delete(sessionId)
      this.terminalToSession.delete(terminalId)
      if (isDev) {
        console.log(`[HookWatcher] Unregistered session ${sessionId} for terminal ${terminalId}`)
      }
    }
  }

  private onStateChange(): void {
    try {
      const content = readFileSync(this.stateFilePath, 'utf-8')
      const hookState: HookStateData = JSON.parse(content)

      // Skip if we've already processed this timestamp (debounce)
      if (hookState.timestamp <= this.lastProcessedTimestamp) {
        return
      }
      this.lastProcessedTimestamp = hookState.timestamp

      // Normalize cwd for comparison
      const normalizedCwd = hookState.cwd ? normalizePath(hookState.cwd) : undefined

      if (isDev) {
        console.log(`[HookWatcher] State change: ${hookState.hook_event} -> ${hookState.state}`)
        console.log(`[HookWatcher]   session: ${hookState.session_id}, cwd: ${normalizedCwd}`)
      }

      // On SessionStart: associate session_id with terminal by cwd
      if (hookState.hook_event === 'SessionStart' && normalizedCwd) {
        const terminalForCwd = this.cwdToTerminal.get(normalizedCwd)
        if (terminalForCwd) {
          // Remove any old session mapping for this terminal (both directions)
          const oldSessionId = this.terminalToSession.get(terminalForCwd)
          if (oldSessionId) {
            this.sessionToTerminal.delete(oldSessionId)
            if (isDev) {
              console.log(`[HookWatcher] Removed old session ${oldSessionId} for terminal ${terminalForCwd}`)
            }
          }
          // Associate new session with terminal (both directions)
          this.sessionToTerminal.set(hookState.session_id, terminalForCwd)
          this.terminalToSession.set(terminalForCwd, hookState.session_id)
          if (isDev) {
            console.log(`[HookWatcher] Associated session ${hookState.session_id} with terminal ${terminalForCwd}`)
          }
        }
      }

      // Find terminal by session_id (primary) or cwd (fallback)
      let terminalId = this.sessionToTerminal.get(hookState.session_id)
      if (!terminalId && normalizedCwd) {
        terminalId = this.cwdToTerminal.get(normalizedCwd)
        if (terminalId) {
          console.warn(`[HookWatcher] Using cwd fallback for session ${hookState.session_id} - session not registered`)
        }
      }

      if (terminalId) {
        console.log(`[HookWatcher] Emitting state ${hookState.state} for terminal ${terminalId}`)
        this.sendToRenderer('terminal:state', terminalId, hookState.state)
      } else if (isDev) {
        console.log(`[HookWatcher] No matching terminal found for session ${hookState.session_id}`)
      }

      // On SessionEnd: cleanup session mapping (both directions)
      if (hookState.hook_event === 'SessionEnd') {
        const terminalId = this.sessionToTerminal.get(hookState.session_id)
        if (terminalId) {
          this.terminalToSession.delete(terminalId)
        }
        this.sessionToTerminal.delete(hookState.session_id)
      }
    } catch (e) {
      // Ignore parse errors (file might be mid-write)
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  /**
   * Get the Claude session ID for a terminal
   */
  getSessionForTerminal(terminalId: string): string | null {
    return this.terminalToSession.get(terminalId) ?? null
  }

  /**
   * Get all terminal-session mappings (for persistence on app close)
   */
  getTerminalSessions(): Array<{ terminalId: string; sessionId: string }> {
    return Array.from(this.terminalToSession.entries()).map(([terminalId, sessionId]) => ({
      terminalId,
      sessionId,
    }))
  }

  stop(): void {
    if (this.watching) {
      unwatchFile(this.stateFilePath)
      this.watching = false
      console.log('[HookWatcher] Stopped watching')
    }
  }
}
