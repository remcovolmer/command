import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL

/** Entry from Claude Code's sessions-index.json */
export interface SessionIndexEntry {
  sessionId: string
  summary: string
  firstPrompt: string
  messageCount: number
  gitBranch: string
  modified: string
  created: string
  projectPath: string
  isSidechain: boolean
}

/** Subset pushed to renderer for a terminal's summary */
export interface SessionSummaryData {
  summary: string
  firstPrompt: string
  messageCount: number
  gitBranch: string
  modified: string
}

interface SessionsIndexFile {
  version: number
  entries: SessionIndexEntry[]
}

/**
 * Encode a project path the same way Claude Code does for its projects directory.
 * Extracted from verifyClaudeSessionAsync() for reuse.
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/\\:]/g, '-').replace(/^-/, '')
}

/**
 * Validate that a parsed object looks like a sessions-index.json entry.
 */
function isValidEntry(value: unknown): value is SessionIndexEntry {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.sessionId === 'string' &&
    typeof obj.summary === 'string' &&
    typeof obj.firstPrompt === 'string' &&
    typeof obj.messageCount === 'number' &&
    typeof obj.modified === 'string'
  )
}

/**
 * Reads and caches Claude Code's sessions-index.json per project.
 * Provides lookup for session summaries and pushes updates via IPC.
 */
export class SessionIndexService {
  private cache: Map<string, SessionIndexEntry> = new Map()
  private pendingProjectPath: string | null = null
  private isReading = false
  private pendingRead = false
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  /**
   * Get the path to sessions-index.json for a given project path.
   */
  private getIndexPath(projectPath: string): string {
    const encoded = encodeProjectPath(projectPath)
    return join(homedir(), '.claude', 'projects', encoded, 'sessions-index.json')
  }

  /**
   * Load and cache the sessions-index.json for a project.
   * Safe to call multiple times — uses isReading guard against concurrent reads.
   */
  async loadForProject(projectPath: string): Promise<void> {
    if (this.isReading) {
      this.pendingProjectPath = projectPath
      this.pendingRead = true
      return
    }
    this.isReading = true

    try {
      let pathToRead = projectPath
      do {
        this.pendingRead = false
        await this.readIndex(pathToRead)
        // If a new project path was requested while reading, use it for the next iteration
        if (this.pendingRead && this.pendingProjectPath) {
          pathToRead = this.pendingProjectPath
          this.pendingProjectPath = null
        }
      } while (this.pendingRead)
    } finally {
      this.isReading = false
    }
  }

  private async readIndex(projectPath: string): Promise<void> {
    const indexPath = this.getIndexPath(projectPath)
    try {
      const content = await readFile(indexPath, 'utf-8')
      const parsed: SessionsIndexFile = JSON.parse(content)

      if (!parsed || !Array.isArray(parsed.entries)) {
        if (isDev) console.warn('[SessionIndex] Invalid format:', indexPath)
        return
      }

      // Rebuild cache from entries
      this.cache.clear()
      for (const entry of parsed.entries) {
        if (isValidEntry(entry)) {
          this.cache.set(entry.sessionId, entry)
        }
      }

      if (isDev) {
        console.log(`[SessionIndex] Loaded ${this.cache.size} entries for ${projectPath}`)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist — new project or no sessions yet
        this.cache.clear()
      } else if (err instanceof SyntaxError) {
        // Malformed JSON — file may be mid-write by Claude Code
        if (isDev) console.warn('[SessionIndex] JSON parse error:', indexPath)
      } else {
        if (isDev) console.error('[SessionIndex] Read error:', err)
      }
    }
  }

  /**
   * Get summary data for a specific session ID.
   */
  getSessionSummary(sessionId: string): SessionSummaryData | undefined {
    const entry = this.cache.get(sessionId)
    if (!entry) return undefined
    return {
      summary: entry.summary,
      firstPrompt: entry.firstPrompt,
      messageCount: entry.messageCount,
      gitBranch: entry.gitBranch,
      modified: entry.modified,
    }
  }

  /**
   * Get all cached entries (for project overview panel).
   * Returns entries sorted by modified date (newest first), limited to `limit`.
   */
  getRecentSessions(limit = 20): SessionIndexEntry[] {
    return Array.from(this.cache.values())
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, limit)
  }

  /**
   * Get all entries for a specific project path (on-demand, not from cache).
   * Used by project overview for inactive projects that aren't the current project.
   */
  async getSessionsForProject(projectPath: string, limit = 20): Promise<SessionIndexEntry[]> {
    const indexPath = this.getIndexPath(projectPath)
    try {
      const content = await readFile(indexPath, 'utf-8')
      const parsed: SessionsIndexFile = JSON.parse(content)

      if (!parsed || !Array.isArray(parsed.entries)) return []

      return parsed.entries
        .filter(isValidEntry)
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
        .slice(0, limit)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && isDev) {
        console.warn('[SessionIndex] getSessionsForProject error:', err)
      }
      return []
    }
  }

  /**
   * Push summary update for a specific terminal to the renderer.
   */
  pushSummaryToRenderer(terminalId: string, sessionId: string): void {
    const summary = this.getSessionSummary(sessionId)
    if (summary) {
      const displaySummary = summary.summary || summary.firstPrompt || ''
      if (displaySummary) {
        this.sendToRenderer('terminal:summary', terminalId, displaySummary)
      }
    }
  }

  /**
   * Re-read index and push updated summaries for all known terminal-session pairs.
   * Called when a terminal transitions to done/stopped.
   */
  async refreshAndPush(
    projectPath: string,
    terminalSessions: Array<{ terminalId: string; sessionId: string }>
  ): Promise<void> {
    await this.loadForProject(projectPath)
    for (const { terminalId, sessionId } of terminalSessions) {
      this.pushSummaryToRenderer(terminalId, sessionId)
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  destroy(): void {
    this.cache.clear()
    this.pendingProjectPath = null
  }
}
