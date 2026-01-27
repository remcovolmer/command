import { watch, FSWatcher, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { homedir } from 'os'

type HookState = 'busy' | 'permission' | 'ready' | 'stopped'

interface HookStateData {
  session_id: string
  cwd: string
  state: HookState
  timestamp: number
  hook_event: string
}

export class ClaudeHookWatcher {
  private watcher: FSWatcher | null = null
  private stateFilePath: string
  private window: BrowserWindow

  // Session ID matching: session_id → terminal_id
  private sessionToTerminal: Map<string, string> = new Map()
  // Persistent cwd → terminal_id mapping (survives session restarts)
  private cwdToTerminal: Map<string, string> = new Map()

  // Debounce file change events
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

    // Watch for file changes
    this.watcher = watch(this.stateFilePath, (eventType) => {
      if (eventType === 'change') {
        this.onStateChange()
      }
    })

    console.log('[HookWatcher] Started watching:', this.stateFilePath)
  }

  /**
   * Register a terminal for a working directory
   */
  registerTerminal(terminalId: string, cwd: string): void {
    // Normalize path for comparison
    const normalizedCwd = cwd.replace(/\\/g, '/')
    this.cwdToTerminal.set(normalizedCwd, terminalId)
    console.log(`[HookWatcher] Registered terminal ${terminalId} for cwd: ${normalizedCwd}`)
  }

  /**
   * Unregister terminal and cleanup all mappings
   */
  unregisterTerminal(terminalId: string): void {
    // Remove from cwd mapping
    for (const [cwd, tid] of this.cwdToTerminal) {
      if (tid === terminalId) {
        this.cwdToTerminal.delete(cwd)
        console.log(`[HookWatcher] Unregistered terminal ${terminalId} from cwd: ${cwd}`)
        break
      }
    }
    // Remove from session mapping
    for (const [sessionId, tid] of this.sessionToTerminal) {
      if (tid === terminalId) {
        this.sessionToTerminal.delete(sessionId)
        console.log(`[HookWatcher] Unregistered session ${sessionId} for terminal ${terminalId}`)
        break
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
      const normalizedCwd = hookState.cwd?.replace(/\\/g, '/')

      console.log(`[HookWatcher] State change: ${hookState.hook_event} -> ${hookState.state}, session: ${hookState.session_id}, cwd: ${normalizedCwd}`)

      // On SessionStart: associate session_id with terminal by cwd
      if (hookState.hook_event === 'SessionStart' && normalizedCwd) {
        const terminalForCwd = this.cwdToTerminal.get(normalizedCwd)
        if (terminalForCwd) {
          // Remove any old session mapping for this terminal
          for (const [oldSessionId, tid] of this.sessionToTerminal) {
            if (tid === terminalForCwd) {
              this.sessionToTerminal.delete(oldSessionId)
              console.log(`[HookWatcher] Removed old session ${oldSessionId} for terminal ${terminalForCwd}`)
              break
            }
          }
          // Associate new session with terminal
          this.sessionToTerminal.set(hookState.session_id, terminalForCwd)
          console.log(`[HookWatcher] Associated session ${hookState.session_id} with terminal ${terminalForCwd}`)
        }
      }

      // Find terminal by session_id (primary) or cwd (fallback)
      let terminalId = this.sessionToTerminal.get(hookState.session_id)
      if (!terminalId && normalizedCwd) {
        terminalId = this.cwdToTerminal.get(normalizedCwd)
      }

      if (terminalId) {
        console.log(`[HookWatcher] Emitting state ${hookState.state} for terminal ${terminalId}`)
        this.sendToRenderer('terminal:state', terminalId, hookState.state)
      } else {
        console.log(`[HookWatcher] No matching terminal found for session ${hookState.session_id}`)
      }

      // On SessionEnd: cleanup session mapping
      if (hookState.hook_event === 'SessionEnd') {
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

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      console.log('[HookWatcher] Stopped watching')
    }
  }
}
