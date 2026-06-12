import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type CrashSource = 'uncaughtException' | 'unhandledRejection' | 'spawnFailed'

export interface LogEntry {
  source: CrashSource
  message: string
  logPath: string
}

const MAX_WRITES_PER_MINUTE = 5

/**
 * Last-resort stderr write for crash paths where the structured logger
 * cannot be trusted (re-entrant crashes, logger failures). Deliberately
 * raw console: anything richer could itself throw and recurse.
 */
export function writeCrashFallback(...args: unknown[]): void {
  try {
    console.error(...args)
  } catch {
    /* stdout/stderr gone; nothing left to do */
  }
}

export class CrashLogger {
  private writeTimestamps: number[] = []
  private cachedLogPath: string | null = null
  private suppressedSinceLastNotice = 0

  /**
   * Resolve crash.log path lazily. Before app.whenReady() the userData path
   * may not be available, so we fall back to os.tmpdir() to keep early-boot
   * crashes loggable. The fallback path is NOT cached — once the app becomes
   * ready, the next call upgrades to userData/crash.log.
   */
  private resolveLogPath(): string {
    if (this.cachedLogPath) return this.cachedLogPath
    let baseDir: string
    let ready = false
    try {
      ready = app.isReady()
      baseDir = ready ? app.getPath('userData') : os.tmpdir()
    } catch {
      baseDir = os.tmpdir()
    }
    try {
      mkdirSync(baseDir, { recursive: true })
    } catch {
      // best-effort; appendFileSync below will report the real failure
    }
    const resolved = path.join(baseDir, 'crash.log')
    // Only pin the cache once we know we are on the final (userData) path.
    if (ready) this.cachedLogPath = resolved
    return resolved
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
      this.suppressedSinceLastNotice++
      return null
    }
    const logPath = this.resolveLogPath()
    const timestamp = new Date(now).toISOString()
    const stack = this.formatError(error)
    const versions = `node ${process.versions.node} / electron ${process.versions.electron ?? 'n/a'}`
    // If prior writes were rate-limit-suppressed, surface the count alongside
    // the next accepted write so the noise floor stays low without losing the
    // signal that the process is unhealthy.
    const suppressionNotice =
      this.suppressedSinceLastNotice > 0
        ? `[rate-limit: ${this.suppressedSinceLastNotice} prior error(s) suppressed in the 60s window]\n`
        : ''
    this.suppressedSinceLastNotice = 0
    const entry = `[${timestamp}] [${source}] ${versions}\n${suppressionNotice}${stack}\n\n`
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
      const segments: string[] = []
      let current: unknown = error
      let depth = 0
      // Walk the .cause chain so wrapped errors (e.g. SpawnError around ENOENT)
      // don't lose the original stack. Depth-cap defends against cyclic refs.
      while (current instanceof Error && depth < 5) {
        const prefix = depth === 0 ? '' : `Caused by: `
        segments.push(prefix + (current.stack ?? `${current.name}: ${current.message}`))
        current = (current as { cause?: unknown }).cause
        depth++
      }
      return segments.join('\n')
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
