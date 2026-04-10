import { describe, test, expect, vi, beforeEach } from 'vitest'
import { encodeProjectPath, SessionIndexService } from '../electron/main/services/SessionIndexService'
import type { SessionIndexEntry } from '../electron/main/services/SessionIndexService'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

import { readFile } from 'fs/promises'
const mockReadFile = vi.mocked(readFile)

function makeEntry(overrides: Partial<SessionIndexEntry> = {}): SessionIndexEntry {
  return {
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    summary: 'Fix login page bug',
    firstPrompt: 'Fix the login page...',
    messageCount: 20,
    gitBranch: 'fix-login',
    modified: '2026-04-10T10:00:00Z',
    created: '2026-04-10T09:00:00Z',
    projectPath: 'C:\\Users\\test\\project',
    isSidechain: false,
    ...overrides,
  }
}

function makeIndexFile(entries: SessionIndexEntry[]) {
  return JSON.stringify({ version: 1, entries })
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
    // Unix paths start with / → becomes - → stripped
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

  describe('loadForProject', () => {
    test('parses valid sessions-index.json and caches entries', async () => {
      const entry1 = makeEntry({ sessionId: 'session-1', summary: 'First session' })
      const entry2 = makeEntry({ sessionId: 'session-2', summary: 'Second session' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry1, entry2]))

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')).toEqual({
        summary: 'First session',
        firstPrompt: 'Fix the login page...',
        messageCount: 20,
        gitBranch: 'fix-login',
        modified: '2026-04-10T10:00:00Z',
      })
      expect(service.getSessionSummary('session-2')?.summary).toBe('Second session')
    })

    test('re-read updates cache with new/modified entries', async () => {
      const entry = makeEntry({ sessionId: 'session-1', summary: 'v1' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.summary).toBe('v1')

      const updated = makeEntry({ sessionId: 'session-1', summary: 'v2' })
      const newEntry = makeEntry({ sessionId: 'session-2', summary: 'new' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([updated, newEntry]))
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.summary).toBe('v2')
      expect(service.getSessionSummary('session-2')?.summary).toBe('new')
    })

    test('handles missing file (ENOENT) — returns empty, no crash', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      mockReadFile.mockRejectedValueOnce(err)

      await service.loadForProject('C:\\Users\\test\\newproject')

      expect(service.getSessionSummary('any-id')).toBeUndefined()
    })

    test('handles malformed JSON — returns empty, no crash', async () => {
      mockReadFile.mockResolvedValueOnce('{ invalid json !!!')

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('any-id')).toBeUndefined()
    })

    test('handles invalid format (no entries array) — no crash', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 1 }))

      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('any-id')).toBeUndefined()
    })
  })

  describe('getSessionSummary', () => {
    test('returns undefined for unknown session ID', async () => {
      const entry = makeEntry({ sessionId: 'known-id' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('unknown-id')).toBeUndefined()
    })
  })

  describe('getRecentSessions', () => {
    test('returns entries sorted by modified date, newest first', async () => {
      const old = makeEntry({ sessionId: 'old', modified: '2026-04-08T10:00:00Z' })
      const mid = makeEntry({ sessionId: 'mid', modified: '2026-04-09T10:00:00Z' })
      const recent = makeEntry({ sessionId: 'recent', modified: '2026-04-10T10:00:00Z' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([old, recent, mid]))
      await service.loadForProject('C:\\Users\\test\\project')

      const result = service.getRecentSessions()
      expect(result.map(e => e.sessionId)).toEqual(['recent', 'mid', 'old'])
    })

    test('respects limit parameter', async () => {
      const entries = Array.from({ length: 25 }, (_, i) =>
        makeEntry({
          sessionId: `session-${i}`,
          modified: new Date(2026, 3, 10, i).toISOString(),
        })
      )
      mockReadFile.mockResolvedValueOnce(makeIndexFile(entries))
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getRecentSessions(5)).toHaveLength(5)
      expect(service.getRecentSessions()).toHaveLength(20) // default limit
    })
  })

  describe('getSessionsForProject', () => {
    test('reads index on-demand for a different project path', async () => {
      const entry = makeEntry({ sessionId: 'other-session' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))

      const result = await service.getSessionsForProject('C:\\Users\\test\\other-project')
      expect(result).toHaveLength(1)
      expect(result[0].sessionId).toBe('other-session')
    })

    test('returns empty array on file read error', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('read error'))

      const result = await service.getSessionsForProject('C:\\Users\\test\\missing')
      expect(result).toEqual([])
    })
  })

  describe('pushSummaryToRenderer', () => {
    test('sends summary via IPC when available', async () => {
      const entry = makeEntry({ sessionId: 'session-1', summary: 'My summary' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'session-1')

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'terminal:summary', 'terminal-1', 'My summary'
      )
    })

    test('falls back to firstPrompt when summary is empty', async () => {
      const entry = makeEntry({ sessionId: 'session-1', summary: '', firstPrompt: 'Fix login' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'session-1')

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'terminal:summary', 'terminal-1', 'Fix login'
      )
    })

    test('does not send when session not found', async () => {
      mockReadFile.mockResolvedValueOnce(makeIndexFile([]))
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'unknown')

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    test('does not send when window is destroyed', async () => {
      mockWindow.isDestroyed.mockReturnValue(true)
      const entry = makeEntry({ sessionId: 'session-1' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))
      await service.loadForProject('C:\\Users\\test\\project')

      service.pushSummaryToRenderer('terminal-1', 'session-1')

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('concurrent read guard', () => {
    test('prevents concurrent reads with isReading guard', async () => {
      let resolveFirst: (value: string) => void
      const firstRead = new Promise<string>(r => { resolveFirst = r })

      mockReadFile.mockReturnValueOnce(firstRead as Promise<string>)
      mockReadFile.mockResolvedValueOnce(makeIndexFile([
        makeEntry({ sessionId: 'final', summary: 'Final state' }),
      ]))

      // Start first load (will block on firstRead)
      const load1 = service.loadForProject('C:\\Users\\test\\project')

      // Start second load while first is in progress — should set pendingRead
      const load2 = service.loadForProject('C:\\Users\\test\\project')

      // Resolve first read
      resolveFirst!(makeIndexFile([makeEntry({ sessionId: 'initial', summary: 'Initial' })]))

      await Promise.all([load1, load2])

      // Should have read twice (initial + pending re-read)
      expect(mockReadFile).toHaveBeenCalledTimes(2)
      // Cache should reflect the second read
      expect(service.getSessionSummary('final')?.summary).toBe('Final state')
    })
  })

  describe('path encoding integration', () => {
    test('Windows path with drive letter produces correct index path', async () => {
      const entry = makeEntry({ sessionId: 'win-session' })
      mockReadFile.mockResolvedValueOnce(makeIndexFile([entry]))

      await service.loadForProject('C:\\Users\\RemcoVolmer\\Code\\command')

      // Verify readFile was called with correctly encoded path
      const callPath = mockReadFile.mock.calls[0][0] as string
      expect(callPath).toContain('C--Users-RemcoVolmer-Code-command')
      expect(callPath).toContain('sessions-index.json')
    })
  })
})
