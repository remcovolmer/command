import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { accessSync } from 'node:fs'
import * as pty from 'node-pty'
import { ClaudeStatusDetector, ClaudeStatus } from './ClaudeStatusDetector'

// Claude Code specific terminal states
type TerminalState = 'starting' | 'busy' | 'question' | 'permission' | 'ready' | 'stopped' | 'error'

interface TerminalInstance {
  id: string
  projectId: string
  pty: pty.IPty
  state: TerminalState
  statusDetector: ClaudeStatusDetector
  lastOutputTime: number
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private idleCheckInterval: NodeJS.Timeout | null = null
  private readonly idleTimeoutMs = 2000 // 2 seconds of no output = potentially ready
  private readonly stateDebounceMs = 300 // Debounce state changes

  constructor(window: BrowserWindow) {
    this.window = window
    this.startIdleChecker()
  }

  /**
   * Start periodic idle check for terminals
   * If a terminal is "busy" but has no output for idleTimeoutMs, mark as "ready"
   */
  private startIdleChecker(): void {
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const [id, terminal] of this.terminals) {
        if (terminal.state === 'busy' && now - terminal.lastOutputTime > this.idleTimeoutMs) {
          // Terminal was busy but idle now - likely finished
          this.updateTerminalState(id, 'ready')
        }
      }
    }, 1000)
  }

  /**
   * Update terminal state with debouncing to avoid flicker
   */
  private updateTerminalState(terminalId: string, newState: TerminalState): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal || terminal.state === newState) return

    terminal.state = newState
    this.sendToRenderer('terminal:state', terminalId, newState)
  }

  createTerminal(cwd: string): string {
    const id = randomUUID()
    const shell = this.getShell()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    })

    const terminal: TerminalInstance = {
      id,
      projectId: cwd,
      pty: ptyProcess,
      state: 'starting',
      statusDetector: new ClaudeStatusDetector(),
      lastOutputTime: Date.now(),
    }

    ptyProcess.onData((data) => {
      // Update last output time
      terminal.lastOutputTime = Date.now()

      // Analyze output for Claude status
      const detectedStatus = terminal.statusDetector.analyzeOutput(data)

      // Update state if a clear status was detected
      if (detectedStatus !== null) {
        this.updateTerminalState(id, detectedStatus)
      }

      // Always forward data to renderer
      this.sendToRenderer('terminal:data', id, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      terminal.statusDetector.clearBuffer()
      terminal.state = 'stopped'
      this.sendToRenderer('terminal:state', id, 'stopped')
      this.sendToRenderer('terminal:exit', id, exitCode)
      this.terminals.delete(id)
    })

    this.terminals.set(id, terminal)

    // Start Claude Code after shell is ready
    setTimeout(() => {
      terminal.state = 'busy'
      this.sendToRenderer('terminal:state', id, 'busy')
      ptyProcess.write('claude\r')
    }, 100)

    return id
  }

  writeToTerminal(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal?.pty) {
      terminal.pty.write(data)
    }
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal?.pty) {
      terminal.pty.resize(cols, rows)
    }
  }

  closeTerminal(terminalId: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      terminal.statusDetector.clearBuffer()
      if (terminal.pty) {
        terminal.pty.kill()
      }
      this.terminals.delete(terminalId)
    }
  }

  closeAllTerminals(): void {
    for (const [id] of this.terminals) {
      this.closeTerminal(id)
    }
  }

  hasActiveTerminals(): boolean {
    return this.terminals.size > 0
  }

  /**
   * Clean up resources when manager is destroyed
   */
  destroy(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
    this.closeAllTerminals()
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  private getShell(): string {
    // Allow override via environment variable
    if (process.env.COMMAND_CENTER_SHELL) {
      console.log('Using shell from COMMAND_CENTER_SHELL:', process.env.COMMAND_CENTER_SHELL)
      return process.env.COMMAND_CENTER_SHELL
    }

    if (process.platform === 'win32') {
      // Common Git Bash locations
      const gitBashPaths = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        process.env.LOCALAPPDATA + '\\Programs\\Git\\bin\\bash.exe',
        process.env.USERPROFILE + '\\scoop\\apps\\git\\current\\bin\\bash.exe',
      ]

      for (const gitBash of gitBashPaths) {
        try {
          accessSync(gitBash)
          console.log('Using Git Bash:', gitBash)
          return gitBash
        } catch {
          // Try next path
        }
      }

      console.log('Git Bash not found, using PowerShell')
      return 'powershell.exe'
    }

    return process.env.SHELL || '/bin/bash'
  }
}
