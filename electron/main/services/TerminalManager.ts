import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { accessSync } from 'node:fs'
import * as pty from 'node-pty'
import { ClaudeHookWatcher } from './ClaudeHookWatcher'

// Claude Code terminal states (5 states)
type TerminalState = 'busy' | 'permission' | 'question' | 'done' | 'stopped'

interface TerminalInstance {
  id: string
  projectId: string
  pty: pty.IPty
  state: TerminalState
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private hookWatcher: ClaudeHookWatcher | null = null

  // Auto-naming: track input buffer and whether terminal has been titled
  private terminalInputBuffers: Map<string, string> = new Map()
  private terminalTitled: Map<string, boolean> = new Map()

  constructor(window: BrowserWindow, hookWatcher?: ClaudeHookWatcher) {
    this.window = window
    this.hookWatcher = hookWatcher || null
  }

  /**
   * Update terminal state
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
      state: 'busy', // Start as busy (starting + busy merged)
    }

    // Register with hook watcher for state detection
    if (this.hookWatcher) {
      this.hookWatcher.registerTerminal(id, cwd)
    }

    ptyProcess.onData((data) => {
      // Forward data to renderer
      this.sendToRenderer('terminal:data', id, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Unregister from hook watcher
      if (this.hookWatcher) {
        this.hookWatcher.unregisterTerminal(id)
      }

      terminal.state = 'stopped'
      this.sendToRenderer('terminal:state', id, 'stopped')
      this.sendToRenderer('terminal:exit', id, exitCode)
      this.terminals.delete(id)
    })

    this.terminals.set(id, terminal)

    // Send initial state
    this.sendToRenderer('terminal:state', id, 'busy')

    // Start Claude Code after shell is ready
    setTimeout(() => {
      ptyProcess.write('claude\r')
    }, 100)

    return id
  }

  writeToTerminal(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal?.pty) {
      // Auto-naming: buffer input and extract title on Enter
      if (!this.terminalTitled.get(terminalId)) {
        this.handleAutoNaming(terminalId, data)
      }

      // When user presses Enter, set to busy immediately
      // The hook system will update to done when Claude finishes
      if (data.includes('\r') || data.includes('\n')) {
        this.updateTerminalState(terminalId, 'busy')
      }
      terminal.pty.write(data)
    }
  }

  /**
   * Handle auto-naming by buffering input and extracting title on Enter
   */
  private handleAutoNaming(terminalId: string, data: string): void {
    // Handle backspace - remove last character from buffer
    if (data === '\x7f' || data === '\b') {
      const buffer = this.terminalInputBuffers.get(terminalId) || ''
      this.terminalInputBuffers.set(terminalId, buffer.slice(0, -1))
      return
    }

    // Handle Enter - extract title from buffer
    if (data.includes('\r') || data.includes('\n')) {
      const buffer = this.terminalInputBuffers.get(terminalId) || ''
      const title = this.extractTaskTitle(buffer)

      if (title) {
        this.terminalTitled.set(terminalId, true)
        this.sendToRenderer('terminal:title', terminalId, title)
      }

      // Clear buffer for next input (in case title extraction failed)
      this.terminalInputBuffers.set(terminalId, '')
      return
    }

    // Accumulate printable characters
    const buffer = this.terminalInputBuffers.get(terminalId) || ''
    this.terminalInputBuffers.set(terminalId, buffer + data)
  }

  /**
   * Extract a meaningful task title from user input
   */
  private extractTaskTitle(input: string): string | null {
    const trimmed = input.trim()

    // Skip empty input
    if (!trimmed || trimmed.length < 3) {
      return null
    }

    // Skip slash commands - wait for a real task
    if (trimmed.startsWith('/')) {
      return null
    }

    // Skip common non-task inputs
    const skipPatterns = [
      /^(hi|hello|hey|yo|sup)$/i,
      /^(yes|no|y|n|ok|okay)$/i,
      /^(exit|quit|q)$/i,
    ]
    if (skipPatterns.some(pattern => pattern.test(trimmed))) {
      return null
    }

    // Extract title: take first 40 chars, capitalize first letter
    let title = trimmed.slice(0, 40)

    // Trim at word boundary if possible
    if (trimmed.length > 40) {
      const lastSpace = title.lastIndexOf(' ')
      if (lastSpace > 20) {
        title = title.slice(0, lastSpace)
      }
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1)

    return title
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
      // Unregister from hook watcher
      if (this.hookWatcher) {
        this.hookWatcher.unregisterTerminal(terminalId)
      }

      // Clean up auto-naming state
      this.terminalInputBuffers.delete(terminalId)
      this.terminalTitled.delete(terminalId)

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
