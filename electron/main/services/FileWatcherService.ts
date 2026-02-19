import { watch, type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import path from 'node:path'
import { existsSync, watch as fsWatch, type FSWatcher as NodeFSWatcher } from 'node:fs'

// Event type mapping from chokidar events to our event types
type FileWatchEventType = 'file-added' | 'file-changed' | 'file-removed' | 'dir-added' | 'dir-removed'

interface FileWatchEvent {
  type: FileWatchEventType
  projectId: string
  path: string
}

const BATCH_INTERVAL = 150  // ms — avoids Electron IPC memory leak at 100ms
const MAX_BATCH_SIZE = 100  // flush early if batch grows too large
const INITIAL_RESTART_DELAY = 5000  // ms before first restart attempt
const MAX_RESTART_ATTEMPTS = 3

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/*.log',
  '**/.DS_Store',
  '**/Thumbs.db',
]

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
  private projectPaths = new Map<string, string>()  // projectId -> projectPath
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
    this.switchLock = this.switchLock.then(async () => {
      // Skip teardown/setup if already watching the right project
      const currentIds = [...this.watchers.keys()]
      if (currentIds.length === 1 && currentIds[0] === projectId) return

      await this.stopAll()
      this.startWatching(projectId, projectPath)
    }).catch(err => {
      console.error('[FileWatcher] switchTo failed:', err)
    })
    return this.switchLock
  }

  startWatching(projectId: string, projectPath: string): void {
    if (this.watchers.has(projectId)) return

    if (!isValidWatchPath(projectPath)) {
      console.warn(`[FileWatcher] Invalid watch path, skipping: ${projectPath}`)
      return
    }

    this.projectPaths.set(projectId, projectPath)

    try {
      const watcher = watch(projectPath, {
        ignoreInitial: true,
        ignored: IGNORE_PATTERNS,
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
        console.error(`[FileWatcher] Error for project ${projectId}:`, message)
        this.sendToRenderer('fs:watch:error', { projectId, error: message })

        // Attempt restart with exponential backoff
        const attempts = this.restartCounts.get(projectId) ?? 0
        if (attempts >= MAX_RESTART_ATTEMPTS) {
          console.error(`[FileWatcher] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached for project ${projectId}`)
          return
        }
        this.restartCounts.set(projectId, attempts + 1)
        const delay = INITIAL_RESTART_DELAY * Math.pow(2, attempts)

        setTimeout(() => {
          if (this.watchers.has(projectId)) {
            console.log(`[FileWatcher] Restart attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS} for project ${projectId}`)
            this.stopWatching(projectId).then(() => {
              const savedPath = this.projectPaths.get(projectId)
              if (savedPath) {
                this.startWatching(projectId, savedPath)
              }
            }).catch((err) => {
              console.error(`[FileWatcher] Restart failed for project ${projectId}:`, err)
            })
          }
        }, delay)
      })

      this.watchers.set(projectId, watcher)
      this.restartCounts.delete(projectId)  // Reset retry count on successful start
      this.startHeadWatcher(projectId, projectPath)
      console.log(`[FileWatcher] Started watching: ${projectPath} (project: ${projectId})`)
    } catch (error) {
      console.error(`[FileWatcher] Failed to start watching ${projectPath}:`, error)
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
    const stops = [...this.watchers.keys()].map(id => this.stopWatching(id))
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
      this.batchBuffer.set(projectId, [])
    }
  }
}
