import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { accessSync } from 'node:fs'
import * as pty from 'node-pty'

type TerminalState = 'starting' | 'running' | 'needs_input' | 'stopped' | 'error'

interface TerminalInstance {
  id: string
  projectId: string
  pty: pty.IPty
  state: TerminalState
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
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
    }

    ptyProcess.onData((data) => {
      this.sendToRenderer('terminal:data', id, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      terminal.state = 'stopped'
      this.sendToRenderer('terminal:state', id, 'stopped')
      this.sendToRenderer('terminal:exit', id, exitCode)
      this.terminals.delete(id)
    })

    this.terminals.set(id, terminal)

    // Start Claude Code after shell is ready
    setTimeout(() => {
      terminal.state = 'running'
      this.sendToRenderer('terminal:state', id, 'running')
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
    if (terminal?.pty) {
      terminal.pty.kill()
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
