import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { accessSync } from 'node:fs'
import * as path from 'node:path'
import * as pty from 'node-pty'
import { ClaudeHookWatcher } from './ClaudeHookWatcher'
import type { ClaudeMode, TerminalState, TerminalType } from '../../../src/types'

const SHELL_READY_DELAY_MS = 100

// Session ID validation regex (alphanumeric, hyphens, underscores only)
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/

export interface CreateTerminalOptions {
  cwd: string
  type?: TerminalType
  initialTitle?: string
  projectId?: string
  worktreeId?: string
  resumeSessionId?: string
  claudeMode?: ClaudeMode
  envOverrides?: Record<string, string>
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

export interface CommandServerAccessor {
  getPort(): number | null
  getToken(): string
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()
  private window: BrowserWindow
  private hookWatcher: ClaudeHookWatcher | null = null
  private commandServer: CommandServerAccessor | null = null
  private cliDir: string

  // Auto-naming: track input buffer and whether terminal has been titled
  private terminalInputBuffers: Map<string, string> = new Map()
  private terminalTitled: Map<string, boolean> = new Map()

  // Eviction buffering: stores PTY data for terminals whose xterm is evicted
  private evictedBuffers: Map<string, string> = new Map()
  private readonly MAX_BUFFER_SIZE = 1_048_576 // 1MB per terminal

  // Sidecar output buffer: rolling buffer for type='normal' terminals
  private sidecarBuffers: Map<string, string> = new Map()
  private readonly MAX_SIDECAR_BUFFER_SIZE = 1_048_576 // 1MB per terminal

  // Defensive PTY write chunking. See writePtySafe() for rationale.
  private readonly PTY_CHUNK_THRESHOLD = 512
  private readonly PTY_CHUNK_SIZE = 512
  private readonly BRACKETED_PASTE_START = '\x1b[200~'
  private readonly BRACKETED_PASTE_END = '\x1b[201~'

  constructor(window: BrowserWindow, hookWatcher?: ClaudeHookWatcher, options?: { commandServer?: CommandServerAccessor; cliDir?: string }) {
    this.window = window
    this.hookWatcher = hookWatcher || null
    this.commandServer = options?.commandServer || null
    // Default CLI dir: relative to compiled output in dev, resourcesPath in production
    this.cliDir = options?.cliDir || path.join(__dirname, '..', 'cli')
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

    // Build env with Command Center vars injected
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }

    // Inject CommandServer connection vars into every terminal
    if (this.commandServer) {
      const port = this.commandServer.getPort()
      if (port !== null) {
        env.COMMAND_CENTER_PORT = String(port)
      }
      env.COMMAND_CENTER_TOKEN = this.commandServer.getToken()
    }
    env.COMMAND_CENTER_TERMINAL_ID = id

    // Prepend CLI directory to PATH so `ccli` is available
    const existingPath = env.PATH || env.Path || ''
    env.PATH = this.cliDir + path.delimiter + existingPath

    // Apply caller-provided overrides last
    if (options.envOverrides) {
      Object.assign(env, options.envOverrides)
    }

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env,
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
      // Buffer output for sidecar (normal) terminals
      if (terminal.type === 'normal') {
        this.bufferSidecarData(id, data)
      }

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
      this.sidecarBuffers.delete(id)
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
      if (options.claudeMode === 'auto') flags.push('--enable-auto-mode')
      else if (options.claudeMode === 'full-auto') flags.push('--dangerously-skip-permissions')
      const claudeCommand = `claude${flags.length ? ' ' + flags.join(' ') : ''}\r`
      const claudeTimeout = setTimeout(() => {
        if (this.terminals.has(id)) ptyProcess.write(claudeCommand)
      }, SHELL_READY_DELAY_MS)
      terminal.timeouts.push(claudeTimeout)
    } else {
      this.sendToRenderer('terminal:state', id, 'done')
    }

    return id
  }

  async writeToTerminal(terminalId: string, data: string): Promise<void> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal?.pty) return

    // Auto-naming: buffer input and extract title on Enter (only for Claude terminals)
    if (terminal.type === 'claude' && !this.terminalTitled.get(terminalId)) {
      this.handleAutoNaming(terminalId, data)
    }

    // When user presses Enter, set to busy immediately (only for Claude terminals)
    // The hook system will update to done when Claude finishes
    if (terminal.type === 'claude' && (data.includes('\r') || data.includes('\n'))) {
      this.updateTerminalState(terminalId, 'busy')
    }

    await this.writePtySafe(terminalId, data)
  }

  /**
   * Write to PTY with defensive chunking for large payloads.
   *
   * pre-1.2 node-pty silently drops EAGAIN writes at ~1KB (fixed upstream in
   * PR #831). Windows ConPTY has its own ring-buffer backpressure that the
   * upstream fix does not cover. Chunking + setImmediate yield gives the
   * kernel / ConPTY a chance to drain between writes.
   *
   * Bracketed-paste markers (\x1b[200~ / \x1b[201~) are never split across
   * chunk boundaries so Claude Code still recognises pastes as one unit.
   * On Windows, \r bytes inside a bracketed-paste block are stripped because
   * ConPTY interprets CRLF inconsistently mid-paste.
   */
  private async writePtySafe(terminalId: string, data: string): Promise<void> {
    if (data.length === 0) return

    if (data.length <= this.PTY_CHUNK_THRESHOLD) {
      const terminal = this.terminals.get(terminalId)
      terminal?.pty?.write(data)
      return
    }

    const prepared = this.stripCarriageReturnsInBracketedPaste(data)
    const chunks = this.chunkForPty(prepared)

    for (const chunk of chunks) {
      const terminal = this.terminals.get(terminalId)
      if (!terminal?.pty) return
      terminal.pty.write(chunk)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  /**
   * Strip \r bytes that fall *inside* a bracketed-paste block on Windows.
   * ConPTY interprets CRLF inconsistently mid-paste; removing \r between
   * \x1b[200~ and \x1b[201~ avoids swallowed content and double-lines.
   * No-op on non-Windows and on payloads without paste markers.
   */
  private stripCarriageReturnsInBracketedPaste(data: string): string {
    if (process.platform !== 'win32') return data
    if (!data.includes(this.BRACKETED_PASTE_START)) return data
    return data.replace(
      /\x1b\[200~([\s\S]*?)\x1b\[201~/g,
      (_match, body: string) => `${this.BRACKETED_PASTE_START}${body.replace(/\r/g, '')}${this.BRACKETED_PASTE_END}`,
    )
  }

  /**
   * Split `data` into chunks of up to PTY_CHUNK_SIZE bytes, never cutting
   * across a 6-byte bracketed-paste marker. If a naive boundary would split
   * a marker, the boundary is rewound so the full marker lands in the next
   * chunk.
   */
  private chunkForPty(data: string): string[] {
    if (data.length <= this.PTY_CHUNK_SIZE) return [data]

    const chunks: string[] = []
    const markerLen = this.BRACKETED_PASTE_START.length // 6
    let pos = 0

    while (pos < data.length) {
      let end = Math.min(pos + this.PTY_CHUNK_SIZE, data.length)

      if (end < data.length) {
        // Walk back up to markerLen-1 bytes looking for ESC. If we find one
        // and it starts a bracketed-paste marker that extends past `end`,
        // rewind `end` to the marker's start so the full marker lands in the
        // next chunk. Only rewind if the result is still a non-empty chunk.
        for (let back = 1; back < markerLen; back++) {
          const probe = end - back
          if (probe <= pos) break
          if (data[probe] === '\x1b') {
            const marker = data.slice(probe, probe + markerLen)
            if (
              (marker === this.BRACKETED_PASTE_START || marker === this.BRACKETED_PASTE_END) &&
              probe + markerLen > end
            ) {
              end = probe
            }
            break
          }
        }
      }

      chunks.push(data.slice(pos, end))
      pos = end
    }

    return chunks
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
        const terminal = this.terminals.get(terminalId)
        if (terminal) terminal.title = title
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

      // Clean up sidecar buffer
      this.sidecarBuffers.delete(terminalId)

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
  getTerminalInfo(terminalId: string): { projectId: string; worktreeId?: string; cwd: string; title?: string; type: TerminalType; state: TerminalState } | null {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return null
    return {
      projectId: terminal.projectId,
      worktreeId: terminal.worktreeId,
      cwd: terminal.cwd,
      title: terminal.title,
      type: terminal.type,
      state: terminal.state,
    }
  }

  /**
   * Get all terminals as a flat array (for query routes).
   */
  getAllTerminals(): Array<{ id: string; projectId: string; worktreeId?: string; title?: string; state: TerminalState; type: TerminalType }> {
    return Array.from(this.terminals.values()).map(t => ({
      id: t.id,
      projectId: t.projectId,
      worktreeId: t.worktreeId,
      title: t.title,
      state: t.state,
      type: t.type,
    }))
  }

  /**
   * Set a terminal's title explicitly and notify the renderer.
   */
  setTerminalTitle(terminalId: string, title: string): void {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return
    terminal.title = title
    this.terminalTitled.set(terminalId, true)
    this.sendToRenderer('terminal:title', terminalId, title)
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
   * Update a terminal's worktree assignment (chat-to-worktree upgrade).
   * Enforces 1:1 constraint: no two terminals may share the same worktreeId.
   */
  updateTerminalWorktree(terminalId: string, worktreeId: string, newCwd: string): { success: boolean; error?: string } {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return { success: false, error: 'Terminal not found' }
    }

    // Enforce 1:1 worktree-terminal constraint
    for (const [id, instance] of this.terminals) {
      if (id !== terminalId && instance.worktreeId === worktreeId) {
        return { success: false, error: `Worktree ${worktreeId} is already assigned to terminal ${id}` }
      }
    }

    terminal.worktreeId = worktreeId
    terminal.cwd = newCwd
    return { success: true }
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
   * Buffer PTY data for a sidecar terminal with size cap.
   */
  private bufferSidecarData(terminalId: string, data: string): void {
    let buffer = this.sidecarBuffers.get(terminalId) ?? ''
    buffer += data
    if (buffer.length > this.MAX_SIDECAR_BUFFER_SIZE) {
      const excess = buffer.length - this.MAX_SIDECAR_BUFFER_SIZE
      const lineBreak = buffer.indexOf('\n', excess)
      buffer = lineBreak !== -1 ? buffer.slice(lineBreak + 1) : buffer.slice(excess)
    }
    this.sidecarBuffers.set(terminalId, buffer)
  }

  /**
   * Get the output buffer for a sidecar terminal.
   */
  getSidecarBuffer(terminalId: string): string | null {
    return this.sidecarBuffers.get(terminalId) ?? null
  }

  /**
   * Write data to a terminal's PTY stdin.
   * Returns true if the write succeeded, false if the terminal was not found.
   */
  writeToPty(terminalId: string, data: string): boolean {
    const terminal = this.terminals.get(terminalId)
    if (!terminal?.pty) return false
    terminal.pty.write(data)
    return true
  }

  /**
   * Get all terminals matching a given project and optional worktree, filtered by type.
   */
  getTerminalsByContext(projectId: string, worktreeId: string | undefined, type: TerminalType): Array<{ id: string; title: string | undefined; lastActivity: number }> {
    const results: Array<{ id: string; title: string | undefined; lastActivity: number }> = []
    for (const terminal of this.terminals.values()) {
      if (terminal.projectId !== projectId) continue
      if (terminal.type !== type) continue
      // Match worktree context: both undefined or both equal
      if (worktreeId) {
        if (terminal.worktreeId !== worktreeId) continue
      } else {
        if (terminal.worktreeId) continue
      }
      results.push({
        id: terminal.id,
        title: terminal.title,
        lastActivity: Date.now(), // no per-terminal timestamp tracked; use current time
      })
    }
    return results
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
