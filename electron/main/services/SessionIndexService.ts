import { readFile, readdir, stat } from 'fs/promises'
import { createReadStream, watch, type FSWatcher } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL

/**
 * Session metadata extracted from JSONL transcript files.
 * Canonical declaration; mirrored in `src/types/index.ts` for renderer use
 * because Electron process isolation prevents a shared import. When you add
 * or rename a field here, update the other declaration in the same commit.
 */
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
  filesModified: string[]
  filesRead: string[]
  toolCounts: Record<string, number>
  errorCount: number
  durationMs: number
  assistantMessageCount: number
  generatedTitle?: string
  generatedSummary?: string
  /** Name of the worktree this session was started in (undefined for root-cwd sessions) */
  worktreeName?: string
}

/** Subset pushed to renderer for a terminal's summary */
export interface SessionSummaryData {
  summary: string
  firstPrompt: string
  messageCount: number
  gitBranch: string
  modified: string
}

/** Path to the hook-generated summary cache file */
const SUMMARY_CACHE_PATH = join(homedir(), '.claude', 'session-summaries.json')

/** Entry in the hook-generated summary cache file */
interface SummaryCacheEntry {
  title: string
  summary: string
  messageCount: number
  generatedAt: string
}

/**
 * Encode a project path the same way Claude Code does for its projects directory.
 *
 * Claude Code replaces every non-alphanumeric character (except `-`) with `-`,
 * without collapsing consecutive dashes. Empirically verified from
 * `~/.claude/projects/` directory names:
 *   - `C:\Users\X\Code\command`           -> `C--Users-X-Code-command`
 *   - `C:\Users\X\Code\pascal_ai`         -> `C--Users-X-Code-pascal-ai`   (`_` -> `-`)
 *   - `C:\Users\X\.claude`                -> `C--Users-X--claude`          (`.` -> `-`)
 *   - `C:\Users\X\Code\command\.worktrees\fix-y`
 *                                          -> `C--Users-X-Code-command--worktrees-fix-y`
 *
 * The leading-dash strip is for Unix paths starting with `/`.
 *
 * KNOWN LIMITATION — distinct paths can collide. `my_project`, `my-project`,
 * and `my.project` all encode to `my-project`. Registering two such projects
 * simultaneously will cross-contaminate their session caches because Claude
 * Code also uses this encoding for its on-disk dir names. Callers cannot
 * disambiguate from the encoded form alone; if you need stable identity,
 * keep the raw `cwd` as the primary key and only use the encoding to locate
 * disk artefacts.
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, '-').replace(/^-/, '')
}

/** Root directory where Claude Code stores per-cwd project session caches. */
function getProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

/**
 * Suffix patterns that indicate a Claude Code project dir belongs to a worktree
 * of another project. Both patterns are anchored by a leading `--` (Claude's
 * encoding of `/.`), which prevents a sibling project literally named
 * `<lastsegment>-worktrees-<x>` from being misclassified as a worktree of
 * `<lastsegment>` — a bare `-worktrees-` pattern was intentionally dropped
 * for that reason. Users storing worktrees under a bare `worktrees/` subdir
 * (no leading dot) will not see them aggregated; rename to `.worktrees/` if
 * aggregation matters.
 */
const WORKTREE_SUFFIX_PATTERNS = [
  '--claude-worktrees-', // Claude Code-managed worktrees: `<project>/.claude/worktrees/<name>`
  '--worktrees-',        // Dotted worktrees dir: `<project>/.worktrees/<name>`
] as const

/** Discriminated union — `worktreeName` is guaranteed present iff `isWorktree`. */
type ProjectDirClassification =
  | { match: false }
  | { match: true; isWorktree: false }
  | { match: true; isWorktree: true; worktreeName: string }

/**
 * Classify a project dir name against an encoded project key.
 * Returns whether it matches the project (root or one of its worktrees).
 */
function classifyProjectDir(
  dirName: string,
  encodedKey: string
): ProjectDirClassification {
  if (dirName === encodedKey) {
    return { match: true, isWorktree: false }
  }
  for (const pattern of WORKTREE_SUFFIX_PATTERNS) {
    const prefix = encodedKey + pattern
    if (dirName.startsWith(prefix)) {
      const worktreeName = dirName.slice(prefix.length)
      // Reject empty names and names that are only dash artefacts (a worktree
      // whose original directory name was a single special char like `.` or `_`
      // encodes to `-`, which carries no useful UI label).
      if (worktreeName.length > 0 && !/^-+$/.test(worktreeName)) {
        return { match: true, isWorktree: true, worktreeName }
      }
    }
  }
  return { match: false }
}

/** Narrow `unknown` to a Node syscall error so we can safely read `.code`. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

/**
 * Extract metadata from a single JSONL session file by reading only what we need.
 * Reads the first few lines for session info, then skips to count messages.
 */
async function parseSessionJsonl(
  filePath: string,
  projectPath: string,
  worktreeName?: string,
): Promise<SessionIndexEntry | null> {
  try {
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })

    let firstPrompt = ''
    let gitBranch = ''
    let created = ''
    let modified = ''
    let isSidechain = false
    let userMessageCount = 0
    let compactSummary = ''
    let assistantMessageCount = 0
    let errorCount = 0
    const filesModifiedSet = new Set<string>()
    const filesReadSet = new Set<string>()
    const toolCounts: Record<string, number> = {}

    for await (const line of rl) {
      if (!line) continue
      try {
        const obj = JSON.parse(line)

        // Track timestamps
        if (obj.timestamp) {
          if (!created) created = obj.timestamp
          modified = obj.timestamp
        }

        // System line often has metadata
        if (obj.type === 'system' && !gitBranch) {
          gitBranch = obj.gitBranch || ''
          if (obj.isSidechain) isSidechain = true
        }

        // First user message = firstPrompt
        if (obj.type === 'user') {
          userMessageCount++
          if (!firstPrompt) {
            const content = typeof obj.message === 'string' ? obj.message : (obj.message?.content || '')
            const stringContent = typeof content === 'string' ? content : ''
            firstPrompt = stringContent
              .replace(/<command-[^>]*>[^<]*<\/command-[^>]*>\s*/g, '')
              // Strip ANSI/xterm control sequences. Match either a real CSI
              // (ESC + `[`) or the specific xterm SGR mouse-tracking shape
              // `[<num;num;numM|m]` that survives ESC stripping. Anything
              // looser (e.g. `\[[?<>!]`) would mangle plain prompts like
              // "[!p]" or "[<a]".
              .replace(/\x1b\[[?<>!]?[\d;]*[a-zA-Z~]|\[<[\d;]+[Mm]/g, '')
              .trim()
              .slice(0, 200)
            if (!gitBranch) gitBranch = obj.gitBranch || ''
          }

          // Count errors from tool_result blocks in user messages
          const userContent = obj.message?.content
          if (Array.isArray(userContent)) {
            for (const block of userContent) {
              if (block?.type === 'tool_result' && block.is_error) {
                errorCount++
              }
            }
          }
        }

        // Assistant messages: extract tool usage and file paths
        if (obj.type === 'assistant') {
          assistantMessageCount++
          const contentBlocks = obj.message?.content
          if (Array.isArray(contentBlocks)) {
            for (const block of contentBlocks) {
              if (block?.type === 'tool_use' && typeof block.name === 'string') {
                const toolName = block.name
                toolCounts[toolName] = (toolCounts[toolName] || 0) + 1

                const filePath = block.input?.file_path
                if (typeof filePath === 'string' && filePath) {
                  if (toolName === 'Edit' || toolName === 'Write') {
                    filesModifiedSet.add(filePath)
                  } else if (toolName === 'Read') {
                    filesReadSet.add(filePath)
                  }
                }
              }
            }
          }
        }

        // Compact summaries generated by Claude Code for context management
        if (obj.isCompactSummary) {
          const text = typeof obj.content === 'string' ? obj.content : (obj.message?.content || '')
          if (text) compactSummary = text.slice(0, 200)
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!firstPrompt && !compactSummary) return null

    // Compute duration from first to last timestamp
    let durationMs = 0
    if (created && modified && created !== modified) {
      const createdMs = new Date(created).getTime()
      const modifiedMs = new Date(modified).getTime()
      if (!isNaN(createdMs) && !isNaN(modifiedMs)) {
        durationMs = Math.max(0, modifiedMs - createdMs)
      }
    }

    const sessionId = filePath.replace(/^.*[\\/]/, '').replace('.jsonl', '')
    return {
      sessionId,
      summary: compactSummary || firstPrompt,
      firstPrompt,
      messageCount: userMessageCount,
      gitBranch,
      modified: modified || new Date().toISOString(),
      created: created || modified || new Date().toISOString(),
      projectPath,
      isSidechain,
      filesModified: Array.from(filesModifiedSet),
      filesRead: Array.from(filesReadSet),
      toolCounts,
      errorCount,
      durationMs,
      assistantMessageCount,
      worktreeName,
    }
  } catch {
    return null
  }
}

/**
 * Scans JSONL session files to build session metadata.
 * Falls back to sessions-index.json if available and fresh.
 *
 * sessions-index.json has been broken since Claude Code v2.1.31 (Feb 2026),
 * so JSONL parsing is the primary data source.
 */
export class SessionIndexService {
  private cache: Map<string, SessionIndexEntry> = new Map()
  private pendingProjectPath: string | null = null
  private activeReadPromise: Promise<void> | null = null
  private window: BrowserWindow
  private summaryCache: Record<string, SummaryCacheEntry> = {}
  private summaryCacheWatcher: FSWatcher | null = null
  private summaryCacheDebounceTimer: ReturnType<typeof setTimeout> | null = null
  /** Terminal-session pairs to push updates for when summary cache changes */
  private knownTerminalSessions: Array<{ terminalId: string; sessionId: string }> = []

  constructor(window: BrowserWindow) {
    this.window = window
    this.startWatchingSummaryCache()
  }

  /**
   * Load session data for a project by scanning JSONL files.
   * If a scan is already in progress, waits for it to complete instead of starting a new one.
   */
  async loadForProject(projectPath: string): Promise<void> {
    if (this.activeReadPromise) {
      this.pendingProjectPath = projectPath
      await this.activeReadPromise
      return
    }

    this.activeReadPromise = this.doScan(projectPath)
    try {
      await this.activeReadPromise
    } finally {
      this.activeReadPromise = null
    }
  }

  private async doScan(projectPath: string): Promise<void> {
    let pathToRead = projectPath
    do {
      this.pendingProjectPath = null
      await this.scanJsonlFiles(pathToRead)
      if (this.pendingProjectPath) {
        pathToRead = this.pendingProjectPath
      }
    } while (this.pendingProjectPath)
  }

  /**
   * Scan JSONL files for the project AND all of its worktree project dirs,
   * populating the cache. Only parses files that are newer than our cached
   * version (incremental).
   *
   * Claude Code creates a separate `~/.claude/projects/<encoded-cwd>` directory
   * per active cwd, so sessions started in a worktree live in their own dir.
   * We discover those by prefix-matching against the project's encoded key
   * (see `classifyProjectDir`).
   */
  private async scanJsonlFiles(projectPath: string): Promise<void> {
    const projectsRoot = getProjectsRoot()
    const encodedKey = encodeProjectPath(projectPath)

    let projectDirs: Array<{ dirName: string; worktreeName?: string }>
    try {
      const allDirs = await readdir(projectsRoot)
      projectDirs = []
      for (const dirName of allDirs) {
        const cls = classifyProjectDir(dirName, encodedKey)
        if (cls.match) {
          projectDirs.push({
            dirName,
            worktreeName: cls.isWorktree ? cls.worktreeName : undefined,
          })
        }
      }
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        // Projects root missing: drop only this project's cached entries.
        // The cache is shared across projects; a blanket clear would purge
        // sessions for unrelated projects loaded earlier in the session.
        this.evictProjectFromCache(projectPath)
        return
      }
      if (isDev) console.error('[SessionIndex] Failed to read projects root:', err)
      return
    }

    if (projectDirs.length === 0) {
      this.evictProjectFromCache(projectPath)
      return
    }

    // Collect jsonl file entries from every matching dir. Track whether every
    // dir was read successfully — a transient failure (EPERM, EBUSY, AV lock)
    // would otherwise cause the eviction sweep below to silently purge cached
    // entries for that dir, leaving the UI empty until the next scan.
    type FileEntry = {
      name: string
      path: string
      mtimeMs: number
      worktreeName?: string
    }
    const allFiles: FileEntry[] = []
    let allDirsRead = true

    for (const { dirName, worktreeName } of projectDirs) {
      const dirPath = join(projectsRoot, dirName)
      try {
        const files = await readdir(dirPath)
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
        const fileStats = await Promise.all(
          jsonlFiles.map(async (f) => {
            const filePath = join(dirPath, f)
            const s = await stat(filePath).catch(() => null)
            return s ? { name: f, path: filePath, mtimeMs: s.mtimeMs, worktreeName } : null
          })
        )
        for (const entry of fileStats) {
          if (entry) allFiles.push(entry)
        }
      } catch (err) {
        // ENOENT on a worktree dir is fine (worktree removed since last scan).
        // Any other error is transient; skip the eviction sweep so we don't
        // purge cached entries that may still be valid.
        if (isErrnoException(err) && err.code !== 'ENOENT') {
          allDirsRead = false
          if (isDev) console.error(`[SessionIndex] Failed to read dir ${dirName}:`, err)
        }
        // Continue with other dirs even if one fails
      }
    }

    // Evict cache entries for files that no longer exist — but only when every
    // contributing dir was read successfully, and only for entries belonging
    // to this project (the cache is shared across projects).
    if (allDirsRead) {
      const currentIds = new Set(allFiles.map(f => f.name.replace(/\.jsonl$/, '')))
      for (const [id, entry] of this.cache.entries()) {
        if (entry.projectPath === projectPath && !currentIds.has(id)) {
          this.cache.delete(id)
        }
      }
    }

    // Only parse files that are new or modified since last cache
    const filesToParse = allFiles.filter(f => {
      const sessionId = f.name.replace(/\.jsonl$/, '')
      const cached = this.cache.get(sessionId)
      if (!cached) return true
      const cachedMs = new Date(cached.modified).getTime()
      return f.mtimeMs > cachedMs + 1000 // 1s tolerance
    })

    if (filesToParse.length > 0) {
      const BATCH_SIZE = 10
      for (let i = 0; i < filesToParse.length; i += BATCH_SIZE) {
        const batch = filesToParse.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(
          batch.map(f => parseSessionJsonl(f.path, projectPath, f.worktreeName))
        )
        for (const entry of results) {
          if (entry) this.cache.set(entry.sessionId, entry)
        }
      }
    }

    // Read and merge hook-generated summaries
    this.summaryCache = await this.readSummaryCache()
    this.mergeSummaryCacheIntoEntries()

    if (isDev) {
      const worktreeCount = projectDirs.filter(d => d.worktreeName).length
      console.log(
        `[SessionIndex] ${this.cache.size} sessions across ${projectDirs.length} dir(s)` +
        ` (${worktreeCount} worktree, parsed ${filesToParse.length} new/updated) for ${projectPath}`
      )
    }
  }

  /**
   * Read the hook-generated summary cache file.
   * Returns empty object if file doesn't exist or is corrupt.
   */
  private async readSummaryCache(): Promise<Record<string, SummaryCacheEntry>> {
    try {
      const content = await readFile(SUMMARY_CACHE_PATH, 'utf-8')
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, SummaryCacheEntry>
      }
      return {}
    } catch {
      // File doesn't exist, is corrupt, or unreadable — graceful fallback
      return {}
    }
  }

  /**
   * Merge hook-generated summaries into cached session entries.
   */
  private mergeSummaryCacheIntoEntries(): void {
    for (const [sessionId, cacheEntry] of Object.entries(this.summaryCache)) {
      const entry = this.cache.get(sessionId)
      if (entry && cacheEntry.title && cacheEntry.summary) {
        entry.generatedTitle = cacheEntry.title
        entry.generatedSummary = cacheEntry.summary
      }
    }
  }

  /**
   * Start watching the hook-generated summary cache file for changes.
   * Uses fs.watch with debounce to handle atomic writes (temp+rename).
   */
  private startWatchingSummaryCache(): void {
    try {
      this.summaryCacheWatcher = watch(SUMMARY_CACHE_PATH, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.debouncedSummaryCacheUpdate()
        }
      })
      // Handle watcher errors gracefully (file may not exist yet)
      this.summaryCacheWatcher.on('error', () => {
        // File may not exist yet — try again later by re-creating watcher
        this.stopWatchingSummaryCache()
        setTimeout(() => this.startWatchingSummaryCache(), 10000)
      })
    } catch {
      // fs.watch can throw if file doesn't exist — retry later
      setTimeout(() => this.startWatchingSummaryCache(), 10000)
    }
  }

  private stopWatchingSummaryCache(): void {
    if (this.summaryCacheWatcher) {
      this.summaryCacheWatcher.close()
      this.summaryCacheWatcher = null
    }
    if (this.summaryCacheDebounceTimer) {
      clearTimeout(this.summaryCacheDebounceTimer)
      this.summaryCacheDebounceTimer = null
    }
  }

  /**
   * Debounced handler for summary cache file changes.
   * Ignores changes within 1 second of each other.
   */
  private debouncedSummaryCacheUpdate(): void {
    if (this.summaryCacheDebounceTimer) {
      clearTimeout(this.summaryCacheDebounceTimer)
    }
    this.summaryCacheDebounceTimer = setTimeout(() => {
      this.summaryCacheDebounceTimer = null
      void this.onSummaryCacheChanged()
    }, 1000)
  }

  /**
   * Handle summary cache file change: re-read cache, merge into entries, push updates.
   */
  private async onSummaryCacheChanged(): Promise<void> {
    this.summaryCache = await this.readSummaryCache()
    this.mergeSummaryCacheIntoEntries()

    // Push updated summaries/titles to renderer for known terminal-session pairs
    for (const { terminalId, sessionId } of this.knownTerminalSessions) {
      this.pushSummaryToRenderer(terminalId, sessionId)
    }
  }

  /**
   * Register terminal-session pairs for receiving summary cache updates.
   */
  registerTerminalSessions(pairs: Array<{ terminalId: string; sessionId: string }>): void {
    this.knownTerminalSessions = pairs
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
   * Get all cached entries sorted by modified date (newest first).
   */
  getRecentSessions(limit = 20): SessionIndexEntry[] {
    return Array.from(this.cache.values())
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, limit)
  }

  /**
   * Get sessions for a specific project path (on-demand scan).
   * Used by the sessions panel and project overview.
   *
   * The cache is shared across projects (keyed by sessionId), so we filter by
   * projectPath here rather than rely on the cache holding only one project's
   * entries — that lets project switches retain previously loaded data and
   * makes a transient FS failure non-destructive for other projects.
   */
  async getSessionsForProject(projectPath: string, limit = 20): Promise<SessionIndexEntry[]> {
    await this.loadForProject(projectPath)
    return Array.from(this.cache.values())
      .filter(e => e.projectPath === projectPath)
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, limit)
  }

  /** Drop cached entries belonging to the given project. */
  private evictProjectFromCache(projectPath: string): void {
    for (const [id, entry] of this.cache.entries()) {
      if (entry.projectPath === projectPath) this.cache.delete(id)
    }
  }

  /**
   * Push summary update for a specific terminal to the renderer.
   * Prefers hook-generated summary/title over raw JSONL data.
   */
  pushSummaryToRenderer(terminalId: string, sessionId: string): void {
    const entry = this.cache.get(sessionId)
    if (!entry) return

    // Prefer generated summary over compact/firstPrompt
    const displaySummary = entry.generatedSummary || entry.summary || entry.firstPrompt || ''
    if (displaySummary) {
      this.sendToRenderer('terminal:summary', terminalId, displaySummary)
    }

    // Push generated title if available
    if (entry.generatedTitle) {
      this.sendToRenderer('terminal:generated-title', terminalId, entry.generatedTitle)
    }
  }

  /**
   * Re-scan and push updated summaries for all known terminal-session pairs.
   */
  async refreshAndPush(
    projectPath: string,
    terminalSessions: Array<{ terminalId: string; sessionId: string }>
  ): Promise<void> {
    // Keep track of known pairs so fs.watch can push updates
    this.knownTerminalSessions = terminalSessions
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
    this.stopWatchingSummaryCache()
    this.cache.clear()
    this.pendingProjectPath = null
    this.knownTerminalSessions = []
  }
}
