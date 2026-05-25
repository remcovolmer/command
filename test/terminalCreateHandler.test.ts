import { describe, test, expect, vi, beforeEach } from 'vitest'
import { handleTerminalCreate } from '../electron/main/handlers/terminalCreate'
import { SpawnError } from '../electron/main/services/errors'
import type { TerminalManager } from '../electron/main/services/TerminalManager'
import type { ProjectPersistence } from '../electron/main/services/ProjectPersistence'
import type { CrashLogger } from '../electron/main/services/CrashLogger'
import type { BrowserWindow } from 'electron'

const VALID_PROJECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeDeps(overrides: Partial<{
  createTerminal: (opts: { cwd: string }) => string
  getProjects: () => Array<{ id: string; path: string; settings?: { claudeMode?: 'chat' | 'auto' | 'full-auto' } }>
  send: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
}> = {}) {
  const send = overrides.send ?? vi.fn()
  const win = {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as BrowserWindow

  const createTerminal = overrides.createTerminal ?? vi.fn(() => 'new-id')
  const terminalManager = { createTerminal } as unknown as TerminalManager

  const getProjects = overrides.getProjects ?? (() => [{ id: VALID_PROJECT_ID, path: '/p' }])
  const projectPersistence = {
    getProjects,
    getWorktreeById: vi.fn(() => null),
  } as unknown as ProjectPersistence

  const log = overrides.log ?? vi.fn()
  const crashLogger = { log } as unknown as CrashLogger

  return {
    deps: {
      terminalManager,
      projectPersistence,
      crashLogger,
      getWindow: () => win,
      resolveEnvOverrides: () => undefined,
      isValidUUID: (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    },
    send,
    createTerminal,
    log,
  }
}

describe('terminal:create IPC handler body', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  test('SpawnError → sends terminal:spawn-failed payload to renderer and resolves with null (no rejection)', async () => {
    const createTerminal = vi.fn(() => {
      throw new SpawnError('CWD_MISSING', '/gone')
    })
    const { deps, send, log } = makeDeps({ createTerminal })

    const result = await handleTerminalCreate(deps, { projectId: VALID_PROJECT_ID })

    expect(result).toBeNull()

    // Renderer was notified
    const spawnFailedCalls = send.mock.calls.filter((c) => c[0] === 'terminal:spawn-failed')
    expect(spawnFailedCalls).toHaveLength(1)
    expect(spawnFailedCalls[0][1]).toMatchObject({
      projectId: VALID_PROJECT_ID,
      code: 'CWD_MISSING',
      cwd: '/gone',
    })

    // crash.log was written via the logger (with source = 'spawnFailed')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe('spawnFailed')

    // Console warning surfaced the code
    expect(consoleWarnSpy).toHaveBeenCalled()
  })

  test('non-SpawnError exception propagates as a rejection', async () => {
    const createTerminal = vi.fn(() => {
      throw new Error('boom')
    })
    const { deps, send } = makeDeps({ createTerminal })

    await expect(
      handleTerminalCreate(deps, { projectId: VALID_PROJECT_ID }),
    ).rejects.toThrow('boom')

    // The spawn-failed channel must NOT have been used for a non-SpawnError
    expect(send.mock.calls.filter((c) => c[0] === 'terminal:spawn-failed')).toHaveLength(0)
  })

  test('happy path returns the new terminal id and does not touch the toast channel', async () => {
    const createTerminal = vi.fn(() => 'tid-123')
    const { deps, send } = makeDeps({ createTerminal })

    const result = await handleTerminalCreate(deps, { projectId: VALID_PROJECT_ID })
    expect(result).toBe('tid-123')
    expect(send.mock.calls.filter((c) => c[0] === 'terminal:spawn-failed')).toHaveLength(0)
  })

  test('invalid projectId rejects with validation error', async () => {
    const { deps } = makeDeps()
    await expect(
      handleTerminalCreate(deps, { projectId: 'not-a-uuid' }),
    ).rejects.toThrow(/Invalid project ID/)
  })

  test('invalid resumeSessionId rejects with validation error (injection guard)', async () => {
    const { deps } = makeDeps()
    await expect(
      handleTerminalCreate(deps, {
        projectId: VALID_PROJECT_ID,
        resumeSessionId: 'evil; rm -rf /',
      }),
    ).rejects.toThrow(/Invalid session ID/)
  })

  // Use the spy variable so eslint doesn't flag it; vitest will auto-restore
  // between tests but we hold a reference for assertions above.
  void consoleWarnSpy
})
