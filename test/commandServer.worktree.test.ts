import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import http from 'node:http'
import { CommandServer, type CommandResponse, type CommandServerDeps } from '../electron/main/services/CommandServer'
import type { TerminalManager } from '../electron/main/services/TerminalManager'
import type { ProjectPersistence } from '../electron/main/services/ProjectPersistence'
import type { WorktreeService } from '../electron/main/services/WorktreeService'
import type { GitHubService } from '../electron/main/services/GitHubService'
import type { BrowserWindow } from 'electron'

/** Make an HTTP request to the CommandServer and return parsed response */
function request(options: {
  port: number
  method: string
  path: string
  token?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
}): Promise<{ statusCode: number; body: CommandResponse }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`
    }

    const bodyStr = options.body ? JSON.stringify(options.body) : undefined

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          try {
            const parsed = JSON.parse(raw) as CommandResponse
            resolve({ statusCode: res.statusCode ?? 0, body: parsed })
          } catch {
            reject(new Error(`Failed to parse response: ${raw}`))
          }
        })
      },
    )

    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

const PROJECT_ID = '00000000-0000-0000-0000-000000000001'
const TERMINAL_ID = '00000000-0000-0000-0000-000000000002'
const WORKTREE_ID = '00000000-0000-0000-0000-000000000003'

function createMockDeps(overrides?: Partial<{
  terminalManager: Partial<TerminalManager>
  projectPersistence: Partial<ProjectPersistence>
  worktreeService: Partial<WorktreeService>
  githubService: Partial<GitHubService>
}>): CommandServerDeps {
  const mockProject = {
    id: PROJECT_ID,
    name: 'test-project',
    path: '/projects/test-project',
    type: 'code' as const,
    createdAt: Date.now(),
    sortOrder: 0,
  }

  return {
    terminalManager: {
      getTerminalInfo: vi.fn().mockReturnValue({
        projectId: PROJECT_ID,
        worktreeId: undefined,
        cwd: '/projects/test-project',
        title: 'test',
        type: 'claude' as const,
      }),
      updateTerminalWorktree: vi.fn().mockReturnValue({ success: true }),
      ...overrides?.terminalManager,
    } as unknown as TerminalManager,
    projectPersistence: {
      getProjects: vi.fn().mockReturnValue([mockProject]),
      addWorktree: vi.fn().mockImplementation((wt: Record<string, unknown>) => wt),
      getWorktreeById: vi.fn().mockReturnValue(null),
      ...overrides?.projectPersistence,
    } as unknown as ProjectPersistence,
    worktreeService: {
      createWorktree: vi.fn().mockResolvedValue({
        path: '/projects/test-project/.worktrees/my-feature',
        branch: 'feat/my-feature',
      }),
      isWorktreePath: vi.fn().mockReturnValue(true),
      hasUncommittedChanges: vi.fn().mockResolvedValue(false),
      ...overrides?.worktreeService,
    } as unknown as WorktreeService,
    githubService: {
      getPRForBranch: vi.fn().mockResolvedValue({ url: 'https://github.com/test/pr/1', number: 1 }),
      mergePR: vi.fn().mockResolvedValue(undefined),
      ...overrides?.githubService,
    } as unknown as GitHubService,
    mainWindow: {
      webContents: {
        send: vi.fn(),
      },
    } as unknown as BrowserWindow,
  }
}

describe('CommandServer worktree routes', () => {
  let server: CommandServer

  beforeAll(async () => {
    server = new CommandServer()
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  // --- POST /worktree/create ---

  describe('POST /worktree/create', () => {
    beforeEach(() => {
      server.setDeps(createMockDeps())
    })

    test('returns 400 when name is missing', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: {},
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('name')
    })

    test('returns 400 when name contains path separators', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: { name: '../escape' },
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('path separators')
    })

    test('returns 400 when branch starts with -', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: { name: 'my-feature', branch: '--dangerous' },
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('must not start with')
    })

    test('returns 400 when X-Terminal-ID header is missing', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: { name: 'my-feature' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('X-Terminal-ID')
    })

    test('returns 400 when terminal is not found', async () => {
      server.setDeps(createMockDeps({
        terminalManager: {
          getTerminalInfo: vi.fn().mockReturnValue(null),
        },
      }))

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: { name: 'my-feature' },
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('Terminal not found')
    })

    test('successfully creates a worktree', async () => {
      const deps = createMockDeps()
      server.setDeps(deps)

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: { name: 'my-feature', branch: 'feat/my-feature' },
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body.ok).toBe(true)

      const data = res.body.data as { worktreeId: string; path: string; branch: string }
      expect(data.path).toBe('/projects/test-project/.worktrees/my-feature')
      expect(data.branch).toBe('feat/my-feature')
      expect(typeof data.worktreeId).toBe('string')

      // Verify services were called
      expect(deps.worktreeService.createWorktree).toHaveBeenCalledWith(
        '/projects/test-project',
        'feat/my-feature',
        'my-feature',
        undefined,
      )
      expect(deps.projectPersistence.addWorktree).toHaveBeenCalled()
      expect(deps.terminalManager.updateTerminalWorktree).toHaveBeenCalled()
      expect((deps.mainWindow.webContents as unknown as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith(
        'worktree:added',
        PROJECT_ID,
        expect.objectContaining({ name: 'my-feature', branch: 'feat/my-feature' }),
      )
    })

    test('uses name as branch when branch is omitted', async () => {
      const deps = createMockDeps()
      server.setDeps(deps)

      await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/create',
        token: server.getToken(),
        body: { name: 'my-feature' },
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(deps.worktreeService.createWorktree).toHaveBeenCalledWith(
        '/projects/test-project',
        'my-feature', // name used as branch
        'my-feature',
        undefined,
      )
    })
  })

  // --- POST /worktree/link ---

  describe('POST /worktree/link', () => {
    beforeEach(() => {
      server.setDeps(createMockDeps())
    })

    test('returns 400 when path is missing', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/link',
        token: server.getToken(),
        body: {},
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('path')
    })

    test('returns 400 when X-Terminal-ID header is missing', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/link',
        token: server.getToken(),
        body: { path: '/some/worktree/path' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('X-Terminal-ID')
    })

    test('returns 400 when path is not under .worktrees/', async () => {
      server.setDeps(createMockDeps({
        worktreeService: {
          isWorktreePath: vi.fn().mockReturnValue(false),
        },
      }))

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/link',
        token: server.getToken(),
        body: { path: '/some/other/path' },
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('.worktrees/')
    })
  })

  // --- POST /worktree/merge ---

  describe('POST /worktree/merge', () => {
    test('returns 400 when X-Terminal-ID header is missing', async () => {
      server.setDeps(createMockDeps())

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/merge',
        token: server.getToken(),
        body: {},
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('X-Terminal-ID')
    })

    test('returns 400 when terminal has no worktree', async () => {
      server.setDeps(createMockDeps({
        terminalManager: {
          getTerminalInfo: vi.fn().mockReturnValue({
            projectId: PROJECT_ID,
            worktreeId: undefined,
            cwd: '/projects/test-project',
            title: 'test',
            type: 'claude' as const,
          }),
        },
      }))

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/merge',
        token: server.getToken(),
        body: {},
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('not associated with a worktree')
    })

    test('returns 400 when no PR found for branch', async () => {
      server.setDeps(createMockDeps({
        terminalManager: {
          getTerminalInfo: vi.fn().mockReturnValue({
            projectId: PROJECT_ID,
            worktreeId: WORKTREE_ID,
            cwd: '/projects/test-project/.worktrees/feat',
            title: 'test',
            type: 'claude' as const,
          }),
        },
        projectPersistence: {
          getWorktreeById: vi.fn().mockReturnValue({
            id: WORKTREE_ID,
            projectId: PROJECT_ID,
            name: 'feat',
            branch: 'feat/my-feature',
            path: '/projects/test-project/.worktrees/feat',
            createdAt: Date.now(),
            isLocked: false,
          }),
        },
        githubService: {
          getPRForBranch: vi.fn().mockResolvedValue(null),
        },
      }))

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/merge',
        token: server.getToken(),
        body: {},
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('No open PR found')
    })

    test('returns 400 when worktree has uncommitted changes', async () => {
      server.setDeps(createMockDeps({
        terminalManager: {
          getTerminalInfo: vi.fn().mockReturnValue({
            projectId: PROJECT_ID,
            worktreeId: WORKTREE_ID,
            cwd: '/projects/test-project/.worktrees/feat',
            title: 'test',
            type: 'claude' as const,
          }),
        },
        projectPersistence: {
          getWorktreeById: vi.fn().mockReturnValue({
            id: WORKTREE_ID,
            projectId: PROJECT_ID,
            name: 'feat',
            branch: 'feat/my-feature',
            path: '/projects/test-project/.worktrees/feat',
            createdAt: Date.now(),
            isLocked: false,
          }),
        },
        worktreeService: {
          hasUncommittedChanges: vi.fn().mockResolvedValue(true),
        },
      }))

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/merge',
        token: server.getToken(),
        body: {},
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toContain('uncommitted changes')
    })

    test('successfully merges a PR', async () => {
      const deps = createMockDeps({
        terminalManager: {
          getTerminalInfo: vi.fn().mockReturnValue({
            projectId: PROJECT_ID,
            worktreeId: WORKTREE_ID,
            cwd: '/projects/test-project/.worktrees/feat',
            title: 'test',
            type: 'claude' as const,
          }),
        },
        projectPersistence: {
          getWorktreeById: vi.fn().mockReturnValue({
            id: WORKTREE_ID,
            projectId: PROJECT_ID,
            name: 'feat',
            branch: 'feat/my-feature',
            path: '/projects/test-project/.worktrees/feat',
            createdAt: Date.now(),
            isLocked: false,
          }),
        },
      })
      server.setDeps(deps)

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/worktree/merge',
        token: server.getToken(),
        body: {},
        headers: { 'X-Terminal-ID': TERMINAL_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body.ok).toBe(true)

      const data = res.body.data as { merged: boolean; prNumber: number; prUrl: string; branch: string }
      expect(data.merged).toBe(true)
      expect(data.prNumber).toBe(1)
      expect(data.prUrl).toBe('https://github.com/test/pr/1')
      expect(data.branch).toBe('feat/my-feature')

      expect(deps.githubService.mergePR).toHaveBeenCalledWith('/projects/test-project', 1)
    })
  })
})
