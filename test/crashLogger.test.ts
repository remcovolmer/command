import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getPath: () => os.tmpdir(),
  },
}))

import { CrashLogger } from '../electron/main/services/CrashLogger'

describe('CrashLogger', () => {
  let logger: CrashLogger
  let logPath: string

  beforeEach(() => {
    logger = new CrashLogger()
    logPath = logger.getLogPath()
    // Start each test with a clean log file
    try {
      fs.unlinkSync(logPath)
    } catch {
      // not present, fine
    }
  })

  afterEach(() => {
    try {
      fs.unlinkSync(logPath)
    } catch {
      // ignore
    }
  })

  test('log() writes a formatted entry containing source and message', () => {
    const entry = logger.log(new Error('boom'), 'uncaughtException')

    expect(entry).not.toBeNull()
    expect(entry?.source).toBe('uncaughtException')
    expect(entry?.message).toBe('boom')

    const contents = fs.readFileSync(logPath, 'utf8')
    expect(contents).toContain('[uncaughtException]')
    expect(contents).toContain('boom')
  })

  test('log() handles non-Error rejections gracefully', () => {
    const entry = logger.log('string reason', 'unhandledRejection')
    expect(entry?.message).toBe('string reason')

    const contents = fs.readFileSync(logPath, 'utf8')
    expect(contents).toContain('[unhandledRejection]')
    expect(contents).toContain('string reason')
  })

  test('rate-limit drops writes beyond 5 per minute', () => {
    for (let i = 0; i < 5; i++) {
      expect(logger.log(new Error(`err-${i}`), 'uncaughtException')).not.toBeNull()
    }
    // 6th write inside the same minute should be dropped
    expect(logger.log(new Error('err-6'), 'uncaughtException')).toBeNull()
  })

  test('log path resolves under tmpdir when app reports tmpdir', () => {
    expect(path.isAbsolute(logPath)).toBe(true)
    expect(path.basename(logPath)).toBe('crash.log')
  })

  test('log entry includes node/electron version line', () => {
    logger.log(new Error('versioned'), 'uncaughtException')
    const contents = fs.readFileSync(logPath, 'utf8')
    expect(contents).toMatch(/node \S+/)
  })
})
