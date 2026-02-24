import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { accessSync } from 'node:fs'
import * as pty from 'node-pty'
import { ClaudeHookWatcher } from './ClaudeHookWatcher'
import type { TerminalState, TerminalType } from '../../../src/types'

const SHELL_READY_DELAY_MS = 100
const CLAUDE_STARTUP_DELAY_MS = 3000

// Session ID validation regex (alphanumeric, hyphens, underscores only)
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/

export interface CreateTerminalOptions {
  cwd: string
  type?: TerminalType
  initialInput?: string
  initialTitle?: string
  projectId?: string
  worktreeId?: string
  resumeSessionId?: string
  dangerouslySkipPermissions?: boolean
}

interface TerminalInstance {
  id: string
  projectId: string
  worktreeId?: string
  cwd: string
  pty: pty.IPty
  state: TerminalState
  type: TerminalType
  title?: string
  timeouts: ReturnType<typeof setTimeout>[]
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private hookWatcher: ClaudeHookWatcher | null = null

  // Auto-naming: track input buffer and whether terminal has been titled
  private terminalInputBuffers: Map<string, string> = new Map()
  private terminalTitled: Map<string, boolean> = new Map()

  // Eviction buffering: stores PTY data for terminals whose xterm is evicted
  private evictedBuffers: Map<string, string> = new Map()
  private readonly MAX_BUFFER_SIZE = 1_048_576 // 1MB per terminal

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

  createTerminal(options: CreateTerminalOptions): string {
    const {
      cwd,
      type = 'claude',
      initialInput,
      initialTitle,
      projectId,
      worktreeId,
    } = options
    let { resumeSessionId } = options

    // Validate session ID to prevent command injection
    if (resumeSessionId && !SESSION_ID_REGEX.test(resumeSessionId)) {
      console.error(`[TerminalManager] Invalid session ID format: ${resumeSessionId}`)
      resumeSessionId = undefined // Fall back to fresh session
    }

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
      projectId: projectId ?? cwd,
      worktreeId,
      cwd,
      pty: ptyProcess,
      state: type === 'normal' ? 'done' : 'busy',
      type,
      title: initialTitle,
      timeouts: [],
    }

    // Register with hook watcher for state detection (only for Claude terminals)
    if (type === 'claude' && this.hookWatcher) {
      this.hookWatcher.registerTerminal(id, cwd)
    }

    ptyProcess.onData((data) => {
      if (this.evictedBuffers.has(id)) {
        // Buffer data for evicted terminal
        this.bufferEvictedData(id, data)
      } else {
        // Forward data to renderer
        this.sendToRenderer('terminal:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Unregister from hook watcher (only for Claude terminals)
      if (terminal.type === 'claude' && this.hookWatcher) {
        this.hookWatcher.unregisterTerminal(id)
      }

      terminal.state = 'stopped'
      this.sendToRenderer('terminal:state', id, 'stopped')
      this.sendToRenderer('terminal:exit', id, exitCode)
      this.terminals.delete(id)
      this.terminalInputBuffers.delete(id)
      this.terminalTitled.delete(id)
      this.evictedBuffers.delete(id)
    })

    this.terminals.set(id, terminal)

    // If initial title is provided, set it and mark as titled (skip auto-naming)
    if (initialTitle) {
      this.terminalTitled.set(id, true)
      this.sendToRenderer('terminal:title', id, initialTitle)
    }

    // Send initial state and start Claude Code (only for Claude terminals)
    if (type === 'claude') {
      this.sendToRenderer('terminal:state', id, 'busy')
      const flags: string[] = []
      if (resumeSessionId) flags.push(`--resume "${resumeSessionId}"`)
      if (options.dangerouslySkipPermissions) flags.push('--dangerously-skip-permissions')
      const claudeCommand = `claude${flags.length ? ' ' + flags.join(' ') : ''}\r`
      const claudeTimeout = setTimeout(() => {
        if (this.terminals.has(id)) ptyProcess.write(claudeCommand)
      }, SHELL_READY_DELAY_MS)
      terminal.timeouts.push(claudeTimeout)

      // If initialInput is provided, send it after Claude has started
      if (initialInput) {
        const inputTimeout = setTimeout(() => {
          if (this.terminals.has(id)) ptyProcess.write(initialInput)
        }, CLAUDE_STARTUP_DELAY_MS)
        terminal.timeouts.push(inputTimeout)
      }
    } else {
      this.sendToRenderer('terminal:state', id, 'done')
    }

    return id
  }

  writeToTerminal(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal?.pty) {
      // Auto-naming: buffer input and extract title on Enter (only for Claude terminals)
      if (terminal.type === 'claude' && !this.terminalTitled.get(terminalId)) {
        this.handleAutoNaming(terminalId, data)
      }

      // When user presses Enter, set to busy immediately (only for Claude terminals)
      // The hook system will update to done when Claude finishes
      if (terminal.type === 'claude' && (data.includes('\r') || data.includes('\n'))) {
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

    // Strip ANSI escape sequences and control characters, only buffer printable text
    const cleaned = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1f\x7f]/g, '')
    if (cleaned) {
      const buffer = this.terminalInputBuffers.get(terminalId) || ''
      this.terminalInputBuffers.set(terminalId, buffer + cleaned)
    }
  }

  /**
   * Extract a meaningful task title from user input
   */
  private extractTaskTitle(input: string): string | null {
    const trimmed = input.replace(/[^\x20-\x7e\u00a0-\uffff]/g, '').trim()

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
      // Clear pending timeouts
      terminal.timeouts?.forEach(clearTimeout)

      // Unregister from hook watcher
      if (this.hookWatcher) {
        this.hookWatcher.unregisterTerminal(terminalId)
      }

      // Clean up auto-naming state
      this.terminalInputBuffers.delete(terminalId)
      this.terminalTitled.delete(terminalId)

      // Clean up eviction state
      this.evictedBuffers.delete(terminalId)

      if (terminal.pty) {
        // On Windows, kill the entire process tree to ensure child processes (like claude) are cleaned up
        if (process.platform === 'win32') {
          try {
            const pid = terminal.pty.pid
            require('node:child_process').execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
          } catch {
            // Process may already be dead
          }
        }
        terminal.pty.kill()
      }
      this.terminals.delete(terminalId)
    }
  }

  /**
   * Close all terminals belonging to a specific project
   */
  closeTerminalsForProject(projectId: string): void {
    for (const [id, terminal] of this.terminals) {
      if (terminal.projectId === projectId) {
        this.closeTerminal(id)
      }
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
   * Get terminal info for persistence (only Claude terminals)
   */
  getTerminalInfo(terminalId: string): { projectId: string; worktreeId?: string; cwd: string; title?: string; type: TerminalType } | null {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return null
    return {
      projectId: terminal.projectId,
      worktreeId: terminal.worktreeId,
      cwd: terminal.cwd,
      title: terminal.title,
      type: terminal.type,
    }
  }

  /**
   * Get all Claude terminal IDs (for session persistence)
   */
  getClaudeTerminalIds(): string[] {
    return Array.from(this.terminals.values())
      .filter(t => t.type === 'claude')
      .map(t => t.id)
  }

  /**
   * Mark a terminal as evicted — start buffering its PTY data
   */
  evictTerminal(terminalId: string): void {
    if (!this.terminals.has(terminalId)) return
    this.evictedBuffers.set(terminalId, '')
  }

  /**
   * Restore a terminal — flush buffered data to renderer and resume forwarding
   */
  restoreTerminal(terminalId: string): void {
    const buffer = this.evictedBuffers.get(terminalId)
    if (buffer === undefined) return

    // Flush buffered data to renderer
    if (buffer.length > 0) {
      // Defer flush to next tick to guarantee renderer event handlers are registered
      setImmediate(() => {
        this.sendToRenderer('terminal:data', terminalId, buffer)
      })
    }

    this.evictedBuffers.delete(terminalId)
  }

  /**
   * Buffer PTY data for an evicted terminal with size cap.
   * Uses single-string concatenation (V8 rope strings) instead of Array.shift() loop.
   */
  private bufferEvictedData(terminalId: string, data: string): void {
    let buffer = this.evictedBuffers.get(terminalId)
    if (buffer === undefined) return

    buffer += data
    if (buffer.length > this.MAX_BUFFER_SIZE) {
      // Trim from front at a line boundary
      const excess = buffer.length - this.MAX_BUFFER_SIZE
      const lineBreak = buffer.indexOf('\n', excess)
      buffer = lineBreak !== -1 ? buffer.slice(lineBreak + 1) : buffer.slice(excess)
    }

    this.evictedBuffers.set(terminalId, buffer)
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
