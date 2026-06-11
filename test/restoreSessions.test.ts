import { describe, test, expect, vi, beforeEach } from 'vitest'
import { restoreSessions } from '../electron/main/handlers/restoreSessions'
import { SpawnError } from '../electron/main/services/errors'
import type { TerminalManager } from '../electron/main/services/TerminalManager'
import type { ProjectPersistence } from '../electron/main/services/ProjectPersistence'
import type { ClaudeHookWatcher } from '../electron/main/services/ClaudeHookWatcher'
import type { BrowserWindow } from 'electron'

function makeWindow(): { send: ReturnType<typeof vi.fn>; win: BrowserWindow } {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as BrowserWindow
  return { send, win }
}

describe('restoreSessions handler', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  test('skips session on SpawnError and continues with the next; emits session:restored only for the survivor; clears sessions at end', async () => {
    const { send, win } = makeWindow()

    const sessions = [
      {
        terminalId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        worktreeId: null,
        claudeSessionId: 'sess-a',
        cwd: '/gone',
        title: 'A',
        closedAt: 1,
      },
      {
        terminalId: '33333333-3333-3333-3333-333333333333',
        projectId: '22222222-2222-2222-2222-222222222222',
        worktreeId: null,
        claudeSessionId: 'sess-b',
        cwd: '/ok',
        title: 'B',
        closedAt: 2,
      },
    ]

    const projects = [
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'p',
        path: '/p',
        type: 'project',
        createdAt: 0,
        sortOrder: 0,
      },
    ]

    const clearSessions = vi.fn()
    const projectPersistence = {
      getSessions: vi.fn(() => sessions),
      getProjects: vi.fn(() => projects),
      getWorktreeById: vi.fn(() => null),
      clearSessions,
    } as unknown as ProjectPersistence

    const createTerminal = vi
      .fn<(opts: { cwd: string }) => string>()
      .mockImplementationOnce((opts) => {
        throw new SpawnError('CWD_MISSING', opts.cwd)
      })
      .mockImplementationOnce(() => 'new-terminal-id')

    const terminalManager = {
      createTerminal,
    } as unknown as TerminalManager

    const hookWatcher = {
      preAssociateSession: vi.fn(),
    } as unknown as ClaudeHookWatcher

    await restoreSessions({
      projectPersistence,
      terminalManager,
      hookWatcher,
      getWindow: () => win,
      verifyClaudeSession: async () => true,
      pathExists: async () => true,
      resolveEnvOverrides: () => undefined,
    })

    // Both createTerminal attempts were made
    expect(createTerminal).toHaveBeenCalledTimes(2)

    // Only the survivor produced a session:restored event
    const restoredCalls = send.mock.calls.filter((c) => c[0] === 'session:restored')
    expect(restoredCalls).toHaveLength(1)
    expect(restoredCalls[0][1]).toMatchObject({
      terminalId: 'new-terminal-id',
      projectId: '22222222-2222-2222-2222-222222222222',
    })

    // The SpawnError surfaced as a warning that mentions the code
    expect(consoleWarnSpy).toHaveBeenCalled()
    const warnings = consoleWarnSpy.mock.calls.map((c) => String(c[0]))
    expect(warnings.some((w) => w.includes('CWD_MISSING'))).toBe(true)

    // No unhandled errors / rejections from the handler itself
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    // Sessions list is cleared at the end
    expect(clearSessions).toHaveBeenCalledTimes(1)
  })

  test('no sessions to restore is a no-op (no createTerminal calls, no IPC sends)', async () => {
    const { send, win } = makeWindow()
    const projectPersistence = {
      getSessions: vi.fn(() => []),
      getProjects: vi.fn(() => []),
      getWorktreeById: vi.fn(() => null),
      clearSessions: vi.fn(),
    } as unknown as ProjectPersistence
    const createTerminal = vi.fn()
    const terminalManager = { createTerminal } as unknown as TerminalManager

    await restoreSessions({
      projectPersistence,
      terminalManager,
      hookWatcher: null,
      getWindow: () => win,
      verifyClaudeSession: async () => true,
      pathExists: async () => true,
      resolveEnvOverrides: () => undefined,
    })

    expect(createTerminal).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  test('returns early when window is missing without throwing', async () => {
    const projectPersistence = {
      getSessions: vi.fn(() => []),
      getProjects: vi.fn(() => []),
      getWorktreeById: vi.fn(() => null),
      clearSessions: vi.fn(),
    } as unknown as ProjectPersistence
    const terminalManager = { createTerminal: vi.fn() } as unknown as TerminalManager

    await expect(
      restoreSessions({
        projectPersistence,
        terminalManager,
        hookWatcher: null,
        getWindow: () => null,
        verifyClaudeSession: async () => true,
        pathExists: async () => true,
        resolveEnvOverrides: () => undefined,
      })
    ).resolves.toBeUndefined()
  })

  // Suppress the unused-var lint warning for the spies; jsdom isn't loaded here so
  // we keep the spies local rather than restoring them in afterEach (vitest auto-resets).
  void consoleLogSpy
})
