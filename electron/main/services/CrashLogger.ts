import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type CrashSource = 'uncaughtException' | 'unhandledRejection'

interface LogEntry {
  source: CrashSource
  message: string
  logPath: string
}

const MAX_WRITES_PER_MINUTE = 5

export class CrashLogger {
  private writeTimestamps: number[] = []
  private cachedLogPath: string | null = null

  /**
   * Resolve crash.log path lazily. Before app.whenReady() the userData path
   * may not be available, so we fall back to os.tmpdir() to keep early-boot
   * crashes loggable.
   */
  private resolveLogPath(): string {
    if (this.cachedLogPath) return this.cachedLogPath
    let baseDir: string
    try {
      baseDir = app.isReady() ? app.getPath('userData') : os.tmpdir()
    } catch {
      baseDir = os.tmpdir()
    }
    try {
      mkdirSync(baseDir, { recursive: true })
    } catch {
      // best-effort; appendFileSync below will report the real failure
    }
    this.cachedLogPath = path.join(baseDir, 'crash.log')
    return this.cachedLogPath
  }

  /**
   * Rate-limit to avoid log spam from a tight error loop. Returns true if the
   * write should proceed.
   */
  private allowWrite(now: number): boolean {
    const windowStart = now - 60_000
    this.writeTimestamps = this.writeTimestamps.filter((t) => t > windowStart)
    if (this.writeTimestamps.length >= MAX_WRITES_PER_MINUTE) return false
    this.writeTimestamps.push(now)
    return true
  }

  log(error: unknown, source: CrashSource): LogEntry | null {
    const now = Date.now()
    if (!this.allowWrite(now)) {
      return null
    }
    const logPath = this.resolveLogPath()
    const timestamp = new Date(now).toISOString()
    const stack = this.formatError(error)
    const versions = `node ${process.versions.node} / electron ${process.versions.electron ?? 'n/a'}`
    const entry = `[${timestamp}] [${source}] ${versions}\n${stack}\n\n`
    try {
      appendFileSync(logPath, entry, { encoding: 'utf8' })
    } catch (writeErr) {
      // Last resort: drop to stderr so the failure is at least visible to dev.
      console.error('[CrashLogger] Failed to write crash log:', writeErr)
    }
    return {
      source,
      message: this.shortMessage(error),
      logPath,
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? `${error.name}: ${error.message}`
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  private shortMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return 'Unknown error'
  }

  getLogPath(): string {
    return this.resolveLogPath()
  }
}
