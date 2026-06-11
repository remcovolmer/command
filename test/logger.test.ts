import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron-log so no real transports are touched. vi.hoisted makes the
// shared spies available inside the hoisted vi.mock factory.
const { mockLog, scoped } = vi.hoisted(() => {
  const scoped = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  const mockLog = {
    initialize: vi.fn(),
    scope: vi.fn(() => scoped),
    transports: {
      file: {
        maxSize: 0,
        level: undefined as unknown,
        getFile: vi.fn(() => ({ path: 'C:\\userData\\logs\\main.log' })),
      },
      console: {
        level: undefined as unknown,
      },
    },
  }
  return { mockLog, scoped }
})

vi.mock('electron-log', () => ({ default: mockLog }))

type LoggerModule = typeof import('../electron/main/services/Logger')

async function freshLogger(): Promise<LoggerModule> {
  vi.resetModules()
  return import('../electron/main/services/Logger')
}

describe('Logger wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLog.transports.file.maxSize = 0
    mockLog.transports.file.level = undefined
    mockLog.transports.console.level = undefined
    delete process.env.COMMAND_CENTER_LOG_LEVEL
  })

  afterEach(() => {
    delete process.env.COMMAND_CENTER_LOG_LEVEL
  })

  test('initLogger configures file transport with rotation size and level', async () => {
    const { initLogger } = await freshLogger()
    initLogger()

    expect(mockLog.initialize).toHaveBeenCalledTimes(1)
    expect(mockLog.transports.file.maxSize).toBe(5 * 1024 * 1024)
    // Test env is not dev: default level is 'info', console transport disabled
    expect(mockLog.transports.file.level).toBe('info')
    expect(mockLog.transports.console.level).toBe(false)
  })

  test('initLogger is idempotent', async () => {
    const { initLogger } = await freshLogger()
    initLogger()
    initLogger()
    expect(mockLog.initialize).toHaveBeenCalledTimes(1)
  })

  test('scoped logger passes scope and arguments through to electron-log', async () => {
    const { initLogger, createLogger } = await freshLogger()
    initLogger()

    const log = createLogger('TerminalManager')
    log.info('spawned pty', 42)

    expect(mockLog.scope).toHaveBeenCalledWith('TerminalManager')
    expect(scoped.info).toHaveBeenCalledWith('spawned pty', 42)
  })

  test('level filtering: debug is dropped when level is info', async () => {
    const { initLogger, createLogger } = await freshLogger()
    initLogger() // default 'info' in non-dev

    const log = createLogger('HookWatcher')
    log.debug('noise')
    log.info('signal')

    expect(scoped.debug).not.toHaveBeenCalled()
    expect(scoped.info).toHaveBeenCalledWith('signal')
  })

  test('level filtering: setLogLevel(error) drops warn/info but keeps error', async () => {
    const { initLogger, createLogger, setLogLevel } = await freshLogger()
    initLogger()
    setLogLevel('error')

    const log = createLogger('GitService')
    log.warn('dropped')
    log.info('dropped')
    log.error('kept')

    expect(scoped.warn).not.toHaveBeenCalled()
    expect(scoped.info).not.toHaveBeenCalled()
    expect(scoped.error).toHaveBeenCalledWith('kept')
  })

  test('COMMAND_CENTER_LOG_LEVEL env var overrides the default level', async () => {
    process.env.COMMAND_CENTER_LOG_LEVEL = 'debug'
    const { initLogger, createLogger } = await freshLogger()
    initLogger()

    expect(mockLog.transports.file.level).toBe('debug')
    const log = createLogger('CommandServer')
    log.debug('verbose line')
    expect(scoped.debug).toHaveBeenCalledWith('verbose line')
  })

  test('invalid COMMAND_CENTER_LOG_LEVEL falls back to default', async () => {
    process.env.COMMAND_CENTER_LOG_LEVEL = 'bogus'
    const { initLogger } = await freshLogger()
    initLogger()
    expect(mockLog.transports.file.level).toBe('info')
  })

  test('before init, calls fall back to console with [scope] prefix', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { createLogger } = await freshLogger()
      const log = createLogger('Session')
      log.info('restoring 3 sessions')

      expect(scoped.info).not.toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('[Session]', 'restoring 3 sessions')
    } finally {
      consoleSpy.mockRestore()
    }
  })

  test('getLogFilePath returns null before init and the transport path after', async () => {
    const { initLogger, getLogFilePath } = await freshLogger()
    expect(getLogFilePath()).toBeNull()
    initLogger()
    expect(getLogFilePath()).toBe('C:\\userData\\logs\\main.log')
  })
})
