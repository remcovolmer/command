import { describe, test, expect, vi, beforeEach } from 'vitest'
import { encodeProjectPath, SessionIndexService } from '../electron/main/services/SessionIndexService'

// Mock fs modules
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}))

vi.mock('readline', () => ({
  createInterface: vi.fn(),
}))

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

import { readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'

const mockReaddir = vi.mocked(readdir)
const mockStat = vi.mocked(stat)
const mockCreateReadStream = vi.mocked(createReadStream)
const mockCreateInterface = vi.mocked(createInterface)

/** Build a fake readline interface that yields JSONL lines */
function mockJsonlFile(lines: Record<string, unknown>[]) {
  const jsonLines = lines.map(l => JSON.stringify(l))
  mockCreateReadStream.mockReturnValueOnce('stream' as never)
  mockCreateInterface.mockReturnValueOnce({
    [Symbol.asyncIterator]: async function* () {
      for (const line of jsonLines) yield line
    },
  } as never)
}

/** Create a minimal JSONL session with system + user lines */
function makeSessionLines(opts: {
  sessionId?: string
  firstPrompt?: string
  gitBranch?: string
  userMessages?: number
  created?: string
  modified?: string
  isSidechain?: boolean
}): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = []
  const created = opts.created || '2026-04-10T09:00:00Z'
  const modified = opts.modified || '2026-04-10T10:00:00Z'

  // System line
  lines.push({
    type: 'system',
    timestamp: created,
    gitBranch: opts.gitBranch || 'main',
    isSidechain: opts.isSidechain || false,
    sessionId: opts.sessionId || 'test-session',
  })

  // User messages
  const msgCount = opts.userMessages ?? 1
  for (let i = 0; i < msgCount; i++) {
    lines.push({
      type: 'user',
      timestamp: i === msgCount - 1 ? modified : created,
      message: { content: i === 0 ? (opts.firstPrompt || 'Hello') : `Message ${i + 1}` },
      gitBranch: opts.gitBranch || 'main',
      sessionId: opts.sessionId || 'test-session',
    })
  }

  return lines
}

function makeMockWindow() {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: vi.fn() },
  } as unknown as import('electron').BrowserWindow
}

describe('encodeProjectPath', () => {
  test('encodes Windows path with drive letter', () => {
    expect(encodeProjectPath('C:\\Users\\test\\project')).toBe('C--Users-test-project')
  })

  test('encodes Unix path', () => {
    expect(encodeProjectPath('/home/user/project')).toBe('home-user-project')
  })

  test('handles mixed separators', () => {
    expect(encodeProjectPath('C:/Users/test\\project')).toBe('C--Users-test-project')
  })

  test('strips leading hyphen after encoding', () => {
    expect(encodeProjectPath('/root')).toBe('root')
  })
})

describe('SessionIndexService', () => {
  let service: SessionIndexService
  let mockWindow: ReturnType<typeof makeMockWindow>

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow = makeMockWindow()
    service = new SessionIndexService(mockWindow as import('electron').BrowserWindow)
  })

  /** Set up mock filesystem with JSONL files */
  function setupJsonlFiles(files: Array<{ name: string; mtimeMs: number; lines: Record<string, unknown>[] }>) {
    mockReaddir.mockResolvedValueOnce(files.map(f => f.name) as never)
    for (const f of files) {
      mockStat.mockResolvedValueOnce({ mtimeMs: f.mtimeMs } as never)
    }
    for (const f of files) {
      mockJsonlFile(f.lines)
    }
  }

  describe('loadForProject', () => {
    test('scans JSONL files and caches entries', async () => {
      setupJsonlFiles([
        {
          name: 'session-1.jsonl',
          mtimeMs: Date.now(),
          lines: makeSessionLines({ sessionId: 'session-1', firstPrompt: 'Fix the login page' }),
        },
        {
          name: 'session-2.jsonl',
          mtimeMs: Date.now(),
          lines: makeSessionLines({ sessionId: 'session-2', firstPrompt: 'Add tests' }),
        },
      ])

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.firstPrompt).toBe('Fix the login page')
      expect(service.getSessionSummary('session-2')?.firstPrompt).toBe('Add tests')
    })

    test('handles empty project directory', async () => {
      mockReaddir.mockResolvedValueOnce([] as never)

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('any-id')).toBeUndefined()
    })

    test('handles missing directory (ENOENT)', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockReaddir.mockRejectedValueOnce(err)

      await service.loadForProject('C:\\Users\\test\\newproject')

      expect(service.getSessionSummary('any-id')).toBeUndefined()
    })

    test('extracts git branch from system line', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({ sessionId: 'session-1', gitBranch: 'feature/auth' }),
      }])

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.gitBranch).toBe('feature/auth')
    })

    test('counts user messages', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({ sessionId: 'session-1', userMessages: 5 }),
      }])

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.messageCount).toBe(5)
    })
  })

  describe('getSessionSummary', () => {
    test('returns undefined for unknown session ID', async () => {
      setupJsonlFiles([{
        name: 'known.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({ sessionId: 'known' }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('unknown')).toBeUndefined()
    })
  })

  describe('getRecentSessions', () => {
    test('returns entries sorted by modified date, newest first', async () => {
      setupJsonlFiles([
        {
          name: 'old.jsonl',
          mtimeMs: Date.now(),
          lines: makeSessionLines({ sessionId: 'old', modified: '2026-04-08T10:00:00Z' }),
        },
        {
          name: 'recent.jsonl',
          mtimeMs: Date.now(),
          lines: makeSessionLines({ sessionId: 'recent', modified: '2026-04-10T10:00:00Z' }),
        },
        {
          name: 'mid.jsonl',
          mtimeMs: Date.now(),
          lines: makeSessionLines({ sessionId: 'mid', modified: '2026-04-09T10:00:00Z' }),
        },
      ])
      await service.loadForProject('C:\\Users\\test\\project')

      const result = service.getRecentSessions()
      expect(result.map(e => e.sessionId)).toEqual(['recent', 'mid', 'old'])
    })

    test('respects limit parameter', async () => {
      const files = Array.from({ length: 25 }, (_, i) => ({
        name: `session-${i}.jsonl`,
        mtimeMs: Date.now(),
        lines: makeSessionLines({
          sessionId: `session-${i}`,
          modified: new Date(2026, 3, 10, i).toISOString(),
        }),
      }))
      setupJsonlFiles(files)
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getRecentSessions(5)).toHaveLength(5)
      expect(service.getRecentSessions()).toHaveLength(20) // default limit
    })
  })

  describe('pushSummaryToRenderer', () => {
    test('sends summary via IPC when available', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({ sessionId: 'session-1', firstPrompt: 'Fix login' }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'session-1')

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'terminal:summary', 'terminal-1', 'Fix login'
      )
    })

    test('does not send when session not found', async () => {
      mockReaddir.mockResolvedValueOnce([] as never)
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'unknown')

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    test('does not send when window is destroyed', async () => {
      mockWindow.isDestroyed.mockReturnValue(true)
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({ sessionId: 'session-1', firstPrompt: 'Fix login' }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'session-1')

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('compact summary support', () => {
    test('uses compact summary when available', async () => {
      const lines = makeSessionLines({ sessionId: 'session-1', firstPrompt: 'Fix the bug' })
      lines.push({
        type: 'assistant',
        isCompactSummary: true,
        content: 'Session about fixing authentication bug',
        timestamp: '2026-04-10T10:30:00Z',
      })

      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines,
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      const summary = service.getSessionSummary('session-1')
      expect(summary?.summary).toBe('Session about fixing authentication bug')
      expect(summary?.firstPrompt).toBe('Fix the bug')
    })
  })
})
