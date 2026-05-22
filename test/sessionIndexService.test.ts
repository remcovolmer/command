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

  test('replaces underscores with dashes (matches Claude Code)', () => {
    // Claude Code's dir naming on disk is `C--Users-X-Code-pascal-ai` for
    // `C:\Users\X\Code\pascal_ai` — the underscore becomes a dash.
    expect(encodeProjectPath('C:\\Users\\test\\Code\\pascal_ai')).toBe('C--Users-test-Code-pascal-ai')
  })

  test('replaces dots with dashes (matches Claude Code)', () => {
    // `.claude` directory becomes `--claude` (preceded by the `\` -> `-` from
    // the path separator, then `.` -> `-`).
    expect(encodeProjectPath('C:\\Users\\test\\.claude')).toBe('C--Users-test--claude')
  })

  test('preserves existing dashes', () => {
    expect(encodeProjectPath('C:\\Users\\test\\my-project')).toBe('C--Users-test-my-project')
  })

  test('encodes path with .worktrees subdirectory', () => {
    expect(encodeProjectPath('C:\\Users\\test\\command\\.worktrees\\fix-x'))
      .toBe('C--Users-test-command--worktrees-fix-x')
  })

  test('encodes path with spaces', () => {
    expect(encodeProjectPath('C:\\Users\\test\\my project'))
      .toBe('C--Users-test-my-project')
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

  /**
   * Set up mock filesystem with JSONL files for a single project dir (no worktrees).
   * Mocks: 1st readdir = projects root (one matching dir), 2nd readdir = the dir's jsonls.
   */
  function setupJsonlFiles(
    files: Array<{ name: string; mtimeMs: number; lines: Record<string, unknown>[] }>,
    opts?: { encodedProjectDir?: string }
  ) {
    const projectDir = opts?.encodedProjectDir ?? 'C--Users-test-project'
    // 1st readdir: projects root contains just this project dir
    mockReaddir.mockResolvedValueOnce([projectDir] as never)
    // 2nd readdir: list jsonls in the project dir
    mockReaddir.mockResolvedValueOnce(files.map(f => f.name) as never)
    for (const f of files) {
      mockStat.mockResolvedValueOnce({ mtimeMs: f.mtimeMs } as never)
    }
    for (const f of files) {
      mockJsonlFile(f.lines)
    }
  }

  /**
   * Set up mock filesystem with files split across the root project dir and
   * one or more worktree dirs. Used to test worktree aggregation.
   */
  function setupMultiDirJsonlFiles(args: {
    encodedKey: string
    dirs: Array<{
      dirName: string
      files: Array<{ name: string; mtimeMs: number; lines: Record<string, unknown>[] }>
    }>
    extraProjectsRootDirs?: string[] // dirs in projects root that should NOT match
  }) {
    const projectRootListing = [
      ...args.dirs.map(d => d.dirName),
      ...(args.extraProjectsRootDirs ?? []),
    ]
    mockReaddir.mockResolvedValueOnce(projectRootListing as never)
    // For each matching dir, a readdir + stats + jsonl mocks
    for (const dir of args.dirs) {
      mockReaddir.mockResolvedValueOnce(dir.files.map(f => f.name) as never)
      for (const f of dir.files) {
        mockStat.mockResolvedValueOnce({ mtimeMs: f.mtimeMs } as never)
      }
      for (const f of dir.files) {
        mockJsonlFile(f.lines)
      }
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

  describe('firstPrompt sanitization', () => {
    test('strips real ESC-prefixed CSI mouse-tracking sequences', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({
          sessionId: 'session-1',
          firstPrompt: '\x1b[<35;21;8MHello world',
        }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.firstPrompt).toBe('Hello world')
    })

    test('strips bare CSI sequences that begin with a private-marker byte', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({
          sessionId: 'session-1',
          firstPrompt: '[<35;21;8MHello world',
        }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.firstPrompt).toBe('Hello world')
    })

    test('preserves plain bracketed text in user prompts', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({
          sessionId: 'session-1',
          firstPrompt: '[wip] [TODO] fix the bug in [feature-x]',
        }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.firstPrompt)
        .toBe('[wip] [TODO] fix the bug in [feature-x]')
    })

    test('preserves bracketed private-marker-like text that is not mouse tracking', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({
          sessionId: 'session-1',
          firstPrompt: 'soft reset [!p] and angle [<a] should survive',
        }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.firstPrompt)
        .toBe('soft reset [!p] and angle [<a] should survive')
    })

    test('strips CSI sequences in the middle of a prompt', async () => {
      setupJsonlFiles([{
        name: 'session-1.jsonl',
        mtimeMs: Date.now(),
        lines: makeSessionLines({
          sessionId: 'session-1',
          firstPrompt: 'before \x1b[<35;21;8Mafter',
        }),
      }])
      await service.loadForProject('C:\\Users\\test\\project')

      expect(service.getSessionSummary('session-1')?.firstPrompt).toBe('before after')
    })
  })

  describe('worktree aggregation', () => {
    test('aggregates sessions from root and worktree dirs into one cache', async () => {
      const projectPath = 'C:\\Users\\test\\command'
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-command',
        dirs: [
          {
            dirName: 'C--Users-test-command',
            files: [{
              name: 'root-session.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'root-session', firstPrompt: 'Root work' }),
            }],
          },
          {
            dirName: 'C--Users-test-command--worktrees-feat-x',
            files: [{
              name: 'wt-x-session.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'wt-x-session', firstPrompt: 'Feature x' }),
            }],
          },
          {
            dirName: 'C--Users-test-command--worktrees-fix-y',
            files: [{
              name: 'wt-y-session.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'wt-y-session', firstPrompt: 'Fix y' }),
            }],
          },
        ],
      })

      await service.loadForProject(projectPath)

      expect(service.getSessionSummary('root-session')?.firstPrompt).toBe('Root work')
      expect(service.getSessionSummary('wt-x-session')?.firstPrompt).toBe('Feature x')
      expect(service.getSessionSummary('wt-y-session')?.firstPrompt).toBe('Fix y')
    })

    test('stores worktreeName for worktree sessions and leaves it undefined for root', async () => {
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-command',
        dirs: [
          {
            dirName: 'C--Users-test-command',
            files: [{
              name: 'root-session.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'root-session' }),
            }],
          },
          {
            dirName: 'C--Users-test-command--worktrees-feat-x',
            files: [{
              name: 'wt-x-session.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'wt-x-session' }),
            }],
          },
        ],
      })

      await service.loadForProject('C:\\Users\\test\\command')

      const recent = service.getRecentSessions()
      const root = recent.find(e => e.sessionId === 'root-session')
      const worktree = recent.find(e => e.sessionId === 'wt-x-session')
      expect(root?.worktreeName).toBeUndefined()
      expect(worktree?.worktreeName).toBe('feat-x')
    })

    test('does NOT match unrelated projects with similar prefix', async () => {
      // `command-mvp` shares the prefix `command-` but is a separate project.
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-command',
        dirs: [
          {
            dirName: 'C--Users-test-command',
            files: [{
              name: 'cmd.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'cmd', firstPrompt: 'command work' }),
            }],
          },
        ],
        extraProjectsRootDirs: [
          'C--Users-test-command-mvp',                // different project
          'C--Users-test-command-mvp--worktrees-foo', // worktree of different project
          'C--Users-test-other',                       // entirely different
        ],
      })

      await service.loadForProject('C:\\Users\\test\\command')

      expect(service.getRecentSessions()).toHaveLength(1)
      expect(service.getSessionSummary('cmd')?.firstPrompt).toBe('command work')
    })

    test('matches the two anchored worktree suffix patterns', async () => {
      // Only `--worktrees-` (from `.worktrees/`) and `--claude-worktrees-`
      // (from `.claude/worktrees/`) are recognised — both anchored by `--`,
      // which Claude's encoding produces from `/.`. A bare `-worktrees-`
      // pattern was intentionally dropped because it collides with sibling
      // projects literally named `<X>-worktrees-<Y>` (see the false-positive
      // regression test below).
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-proj',
        dirs: [
          {
            dirName: 'C--Users-test-proj--worktrees-dotted',
            files: [{
              name: 'a.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'a' }),
            }],
          },
          {
            dirName: 'C--Users-test-proj--claude-worktrees-managed',
            files: [{
              name: 'c.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'c' }),
            }],
          },
        ],
      })

      await service.loadForProject('C:\\Users\\test\\proj')

      const recent = service.getRecentSessions()
      expect(recent.find(e => e.sessionId === 'a')?.worktreeName).toBe('dotted')
      expect(recent.find(e => e.sessionId === 'c')?.worktreeName).toBe('managed')
    })

    test('does NOT misclassify sibling project literally named `<X>-worktrees-<Y>`', async () => {
      // Regression guard: a sibling project at literal disk path
      // `C:\Users\test\command-worktrees-bar` encodes to
      // `C--Users-test-command-worktrees-bar`. The encoded form is
      // indistinguishable from a worktree of `command` under a bare
      // `worktrees/` subdir, so we no longer match that shape — the sibling
      // project must not contribute sessions to `command`'s overview.
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-command',
        dirs: [
          {
            dirName: 'C--Users-test-command',
            files: [{
              name: 'cmd.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'cmd', firstPrompt: 'command work' }),
            }],
          },
        ],
        extraProjectsRootDirs: [
          'C--Users-test-command-worktrees-bar', // sibling project, NOT a worktree
        ],
      })

      await service.loadForProject('C:\\Users\\test\\command')

      expect(service.getRecentSessions()).toHaveLength(1)
      expect(service.getSessionSummary('cmd')?.firstPrompt).toBe('command work')
    })

    test('rejects worktree dir whose name is only dash artefacts', async () => {
      // A worktree literally named `.` or `_` encodes its suffix to `-`,
      // which would render a meaningless `Worktree: -` badge. The classifier
      // skips these.
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-proj',
        dirs: [
          {
            dirName: 'C--Users-test-proj',
            files: [{
              name: 'root.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'root' }),
            }],
          },
        ],
        extraProjectsRootDirs: [
          'C--Users-test-proj--worktrees--',   // worktree name == '-'
          'C--Users-test-proj--worktrees---',  // worktree name == '--'
        ],
      })

      await service.loadForProject('C:\\Users\\test\\proj')

      expect(service.getRecentSessions()).toHaveLength(1)
    })

    test('returns no sessions when root and worktree dirs are all empty', async () => {
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-empty',
        dirs: [], // no matching project dirs at all
      })

      await service.loadForProject('C:\\Users\\test\\empty')

      expect(service.getRecentSessions()).toHaveLength(0)
    })

    test('still finds worktree sessions when root project dir does not exist', async () => {
      // Use case: user opens a project, but the only sessions ever started
      // were inside worktrees. The root cwd never spawned a chat.
      setupMultiDirJsonlFiles({
        encodedKey: 'C--Users-test-proj',
        dirs: [
          {
            dirName: 'C--Users-test-proj--worktrees-only',
            files: [{
              name: 'wt.jsonl',
              mtimeMs: Date.now(),
              lines: makeSessionLines({ sessionId: 'wt', firstPrompt: 'Worktree only' }),
            }],
          },
        ],
      })

      await service.loadForProject('C:\\Users\\test\\proj')

      const recent = service.getRecentSessions()
      expect(recent.find(e => e.sessionId === 'wt')?.firstPrompt).toBe('Worktree only')
      expect(recent.find(e => e.sessionId === 'wt')?.worktreeName).toBe('only')
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
