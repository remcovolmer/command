import { watch, type FSWatcher } from 'chokidar'
import { type BrowserWindow } from 'electron'
import path from 'node:path'
import { existsSync, watch as fsWatch, type FSWatcher as NodeFSWatcher } from 'node:fs'
import { createLogger } from './Logger'

const log = createLogger('FileWatcher')

// Event type mapping from chokidar events to our event types
type FileWatchEventType =
  | 'file-added'
  | 'file-changed'
  | 'file-removed'
  | 'dir-added'
  | 'dir-removed'

interface FileWatchEvent {
  type: FileWatchEventType
  projectId: string
  path: string
}

const BATCH_INTERVAL = 150 // ms — avoids Electron IPC memory leak at 100ms
const MAX_BATCH_SIZE = 100 // flush early if batch grows too large
const INITIAL_RESTART_DELAY = 5000 // ms before first restart attempt
const MAX_RESTART_ATTEMPTS = 3

// chokidar v4 removed glob support: the `ignored` option now only accepts a
// path string, a RegExp, or a predicate. The old glob strings (e.g.
// `**/node_modules/**`) silently matched nothing under v4, so the watcher
// walked the entire tree — including every node_modules and every nested
// worktree under .worktrees/ — pegging the main process for tens of seconds
// on switch to a worktree-heavy project. Match by path segment (relative to
// the watch root) so chokidar prunes the whole subtree at the directory and
// never descends into it.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  '.worktrees',
])

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/**
 * True if `filePath` should be excluded from watching. Evaluated against the
 * path's segments relative to `rootPath`, so a watch-root ancestor named e.g.
 * "build" cannot accidentally exclude the whole project. The root itself is
 * never ignored. chokidar v4 calls this for directories too, so returning true
 * for a directory prunes its entire subtree before descent.
 */
export function isIgnoredPath(filePath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, filePath)
  if (!rel || rel.startsWith('..')) return false // the root itself, or outside it
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const basename = segments[segments.length - 1] ?? ''
  if (IGNORED_FILES.has(basename) || basename.endsWith('.log')) return true
  return segments.some((segment) => IGNORED_DIRS.has(segment))
}

/**
 * Validate that a path is safe to watch (not a root or system directory).
 * Requires at least 3 path segments (e.g., C:\Users\name\project).
 */
function isValidWatchPath(projectPath: string): boolean {
  const resolved = path.resolve(projectPath)
  const segments = resolved.split(path.sep).filter(Boolean)
  return segments.length >= 3 && existsSync(resolved)
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase()
}

/**
 * Centralized file watcher service using chokidar.
 * Runs one watcher per project root and emits batched IPC events to the renderer.
 */
export class FileWatcherService {
  private window: BrowserWindow
  private watchers = new Map<string, FSWatcher>()
  private batchBuffer = new Map<string, FileWatchEvent[]>()
  private batchTimers = new Map<string, NodeJS.Timeout>()
  private projectPaths = new Map<string, string>() // projectId -> projectPath
  private restartCounts = new Map<string, number>()
  private headWatchers = new Map<string, NodeFSWatcher>()

  private switchLock: Promise<void> = Promise.resolve()

  constructor(window: BrowserWindow) {
    this.window = window
  }

  /**
   * Atomically switch to watching a single project.
   * Serialized: concurrent calls queue instead of interleaving.
   */
  async switchTo(projectId: string, projectPath: string): Promise<void> {
    this.switchLock = this.switchLock
      .then(async () => {
        // Skip teardown/setup if already watching the right project
        const currentIds = [...this.watchers.keys()]
        if (currentIds.length === 1 && currentIds[0] === projectId) return

        await this.stopAll()
        this.startWatching(projectId, projectPath)
      })
      .catch((err) => {
        log.error('switchTo failed:', err)
      })
    return this.switchLock
  }

  startWatching(projectId: string, projectPath: string): void {
    if (this.watchers.has(projectId)) return

    if (!isValidWatchPath(projectPath)) {
      log.warn(`Invalid watch path, skipping: ${projectPath}`)
      return
    }

    this.projectPaths.set(projectId, projectPath)

    try {
      const watcher = watch(projectPath, {
        ignoreInitial: true,
        ignored: (p: string) => isIgnoredPath(p, projectPath),
        followSymlinks: false,
        atomic: true,
        ignorePermissionErrors: true,
        usePolling: false,
        persistent: true,
      })

      // Register event handlers for all file/dir operations
      const handleChokidarEvent = (eventType: FileWatchEventType) => (filePath: string) => {
        this.handleEvent(projectId, eventType, filePath)
      }
      watcher.on('add', handleChokidarEvent('file-added'))
      watcher.on('change', handleChokidarEvent('file-changed'))
      watcher.on('unlink', handleChokidarEvent('file-removed'))
      watcher.on('addDir', handleChokidarEvent('dir-added'))
      watcher.on('unlinkDir', handleChokidarEvent('dir-removed'))

      watcher.on('error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        log.error(`Error for project ${projectId}:`, message)
        this.sendToRenderer('fs:watch:error', { projectId, error: message })

        // Attempt restart with exponential backoff
        const attempts = this.restartCounts.get(projectId) ?? 0
        if (attempts >= MAX_RESTART_ATTEMPTS) {
          log.error(
            `Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached for project ${projectId}`
          )
          return
        }
        this.restartCounts.set(projectId, attempts + 1)
        const delay = INITIAL_RESTART_DELAY * Math.pow(2, attempts)

        setTimeout(() => {
          if (this.watchers.has(projectId)) {
            log.info(
              `Restart attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS} for project ${projectId}`
            )
            this.stopWatching(projectId)
              .then(() => {
                const savedPath = this.projectPaths.get(projectId)
                if (savedPath) {
                  this.startWatching(projectId, savedPath)
                }
              })
              .catch((err) => {
                log.error(`Restart failed for project ${projectId}:`, err)
              })
          }
        }, delay)
      })

      this.watchers.set(projectId, watcher)
      this.restartCounts.delete(projectId) // Reset retry count on successful start
      this.startHeadWatcher(projectId, projectPath)
      log.info(`Started watching: ${projectPath} (project: ${projectId})`)
    } catch (error) {
      log.error(`Failed to start watching ${projectPath}:`, error)
    }
  }

  async stopWatching(projectId: string): Promise<void> {
    const watcher = this.watchers.get(projectId)
    if (!watcher) return

    clearTimeout(this.batchTimers.get(projectId))
    this.batchTimers.delete(projectId)
    this.batchBuffer.delete(projectId)
    this.watchers.delete(projectId)
    this.projectPaths.delete(projectId)
    this.restartCounts.delete(projectId)

    const headWatcher = this.headWatchers.get(projectId)
    if (headWatcher) {
      headWatcher.close()
      this.headWatchers.delete(projectId)
    }

    try {
      await watcher.close()
    } catch {
      // Ignore close errors during shutdown
    }
  }

  async stopAll(): Promise<void> {
    const stops = [...this.watchers.keys()].map((id) => this.stopWatching(id))
    await Promise.all(stops)
    this.projectPaths.clear()
  }

  /**
   * Watch .git/HEAD for git-only operations (commits, checkouts, rebases).
   * Chokidar ignores .git/**, so we use Node's fs.watch for this single file.
   */
  private startHeadWatcher(projectId: string, projectPath: string): void {
    const headPath = path.join(projectPath, '.git', 'HEAD')
    if (!existsSync(headPath)) return

    try {
      const watcher = fsWatch(headPath, () => {
        this.handleEvent(projectId, 'file-changed', headPath)
      })
      watcher.on('error', () => {
        // Best-effort — silently stop on error
        watcher.close()
        this.headWatchers.delete(projectId)
      })
      this.headWatchers.set(projectId, watcher)
    } catch {
      // Best-effort — .git/HEAD watch is non-critical
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  private handleEvent(projectId: string, type: FileWatchEventType, filePath: string): void {
    const normalized = normalizePath(filePath)
    const buffer = this.batchBuffer.get(projectId) ?? []
    buffer.push({ type, projectId, path: normalized })
    this.batchBuffer.set(projectId, buffer)

    if (buffer.length >= MAX_BATCH_SIZE) {
      this.flushBatch(projectId)
    } else if (!this.batchTimers.has(projectId)) {
      this.batchTimers.set(
        projectId,
        setTimeout(() => this.flushBatch(projectId), BATCH_INTERVAL)
      )
    }
  }

  private flushBatch(projectId: string): void {
    clearTimeout(this.batchTimers.get(projectId))
    this.batchTimers.delete(projectId)
    const events = this.batchBuffer.get(projectId)
    if (events?.length) {
      this.sendToRenderer('fs:watch:changes', events)

      // Notify file change listeners (used by AutomationService)
      for (const cb of this.fileChangeCallbacks) {
        try {
          cb(events)
        } catch (err) {
          // Batches flush at most once per debounce window, so an
          // unconditional warn cannot spam the log.
          log.warn('File change listener threw:', err)
        }
      }

      this.batchBuffer.set(projectId, [])
    }
  }

  // --- File change listener registration ---
  private fileChangeCallbacks: Array<(events: FileWatchEvent[]) => void> = []

  onFileChanges(callback: (events: FileWatchEvent[]) => void): () => void {
    this.fileChangeCallbacks.push(callback)
    return () => {
      const idx = this.fileChangeCallbacks.indexOf(callback)
      if (idx !== -1) this.fileChangeCallbacks.splice(idx, 1)
    }
  }
}
