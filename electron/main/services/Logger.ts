import log from 'electron-log'

/**
 * Thin wrapper around electron-log for the main process.
 *
 * Design constraints:
 * - No side effects at import time: transports are only configured when
 *   `initLogger()` is called explicitly from the main entry point. Before
 *   init (and in unit tests), log calls fall back to the console so behavior
 *   matches the previous raw `console.*` calls.
 * - Services import this wrapper, never electron-log directly, so the
 *   transport configuration lives in exactly one place and tests can mock
 *   the 'electron-log' module.
 * - Level filtering happens in the wrapper itself (in addition to the
 *   transports), which keeps it testable without real transports.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface ScopedLogger {
  error(...params: unknown[]): void
  warn(...params: unknown[]): void
  info(...params: unknown[]): void
  debug(...params: unknown[]): void
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_PRIORITY))

const MAX_LOG_FILE_SIZE = 5 * 1024 * 1024 // ~5MB, electron-log rotates to <name>.old.log

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL

function resolveLevelFromEnv(): LogLevel {
  const envLevel = process.env.COMMAND_CENTER_LOG_LEVEL?.toLowerCase()
  if (envLevel && VALID_LEVELS.has(envLevel)) return envLevel as LogLevel
  return isDev ? 'debug' : 'info'
}

let currentLevel: LogLevel = resolveLevelFromEnv()
let initialized = false

/**
 * Configure electron-log transports. Must be called once from the main
 * entry point, before (or right after) other services start logging.
 * Safe to call before app.whenReady(): the file path resolves lazily.
 */
export function initLogger(): void {
  if (initialized) return
  currentLevel = resolveLevelFromEnv()
  log.initialize()
  log.transports.file.maxSize = MAX_LOG_FILE_SIZE
  log.transports.file.level = currentLevel
  // In production the main process has no attached terminal; skip the
  // console transport entirely so logging cost stays minimal.
  log.transports.console.level = isDev ? currentLevel : false
  initialized = true
}

/** Whether a message at `level` passes the current level filter. */
function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel]
}

/** Override the active log level (also used by tests). */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level
  if (initialized) {
    log.transports.file.level = level
    if (log.transports.console.level !== false) {
      log.transports.console.level = level
    }
  }
}

/** Absolute path of the active log file, or null when not initialized. */
export function getLogFilePath(): string | null {
  if (!initialized) return null
  try {
    return log.transports.file.getFile().path
  } catch {
    return null
  }
}

// Pre-init fallback: matches the previous raw console.* behavior.
// Late-bound (not `console.warn` references) so test spies installed after
// this module loads still observe the calls.
const CONSOLE_FALLBACK: Record<LogLevel, (...params: unknown[]) => void> = {
  error: (...params) => console.error(...params),
  warn: (...params) => console.warn(...params),
  info: (...params) => console.log(...params),
  debug: (...params) => console.log(...params),
}

/**
 * Create a logger bound to a scope (typically the service name).
 * The scope replaces the previous hand-written `[ServiceName]` prefixes.
 */
export function createLogger(scope: string): ScopedLogger {
  const emit = (level: LogLevel, params: unknown[]): void => {
    if (!isLevelEnabled(level)) return
    if (initialized) {
      log.scope(scope)[level](...params)
    } else {
      CONSOLE_FALLBACK[level](`[${scope}]`, ...params)
    }
  }

  return {
    error: (...params: unknown[]) => emit('error', params),
    warn: (...params: unknown[]) => emit('warn', params),
    info: (...params: unknown[]) => emit('info', params),
    debug: (...params: unknown[]) => emit('debug', params),
  }
}
