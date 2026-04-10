import { describe, test, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import path from 'node:path'

// Import the CJS module internals
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ccli = require('../electron/main/cli/ccli.cjs') as {
  parseArgs: (argv: string[]) => { positional: string[]; flags: Record<string, string | boolean> }
  buildRoute: (
    positional: string[],
    flags: Record<string, string | boolean>,
  ) => { method?: string; path?: string; body?: Record<string, unknown>; error?: string }
  formatPretty: (data: unknown) => string
  httpRequest: (
    method: string,
    urlPath: string,
    body: Record<string, unknown> | null,
    env: { port: number; terminalId: string; token: string },
  ) => Promise<{ statusCode: number; body: Record<string, unknown> }>
  VERSION: string
}

describe('ccli', () => {
  // --- parseArgs ---

  describe('parseArgs', () => {
    test('parses positional args', () => {
      const result = ccli.parseArgs(['worktree', 'create', 'foo'])
      expect(result.positional).toEqual(['worktree', 'create', 'foo'])
      expect(result.flags).toEqual({})
    })

    test('parses flags with values', () => {
      const result = ccli.parseArgs(['open', 'file.ts', '--line', '42'])
      expect(result.positional).toEqual(['open', 'file.ts'])
      expect(result.flags).toEqual({ line: '42' })
    })

    test('parses boolean flags', () => {
      const result = ccli.parseArgs(['chat', 'list', '--pretty'])
      expect(result.positional).toEqual(['chat', 'list'])
      expect(result.flags).toEqual({ pretty: true })
    })

    test('parses mixed args and flags', () => {
      const result = ccli.parseArgs([
        'worktree',
        'create',
        'feat-auth',
        '--branch',
        'feature/auth',
        '--source',
        'main',
        '--pretty',
      ])
      expect(result.positional).toEqual(['worktree', 'create', 'feat-auth'])
      expect(result.flags).toEqual({ branch: 'feature/auth', source: 'main', pretty: true })
    })
  })

  // --- buildRoute ---

  describe('buildRoute', () => {
    test('worktree create maps to POST /worktree/create', () => {
      const route = ccli.buildRoute(['worktree', 'create', 'foo'], {})
      expect(route).toEqual({
        method: 'POST',
        path: '/worktree/create',
        body: { name: 'foo' },
      })
    })

    test('worktree create with branch and source flags', () => {
      const route = ccli.buildRoute(['worktree', 'create', 'foo'], {
        branch: 'feat/foo',
        source: 'develop',
      })
      expect(route).toEqual({
        method: 'POST',
        path: '/worktree/create',
        body: { name: 'foo', branch: 'feat/foo', sourceBranch: 'develop' },
      })
    })

    test('worktree create without name returns error', () => {
      const route = ccli.buildRoute(['worktree', 'create'], {})
      expect(route.error).toBeTruthy()
    })

    test('worktree link resolves path to absolute', () => {
      const route = ccli.buildRoute(['worktree', 'link', './my-worktree'], {})
      expect(route.method).toBe('POST')
      expect(route.path).toBe('/worktree/link')
      expect(path.isAbsolute(route.body!.path as string)).toBe(true)
    })

    test('worktree merge maps to POST /worktree/merge', () => {
      const route = ccli.buildRoute(['worktree', 'merge'], {})
      expect(route).toEqual({
        method: 'POST',
        path: '/worktree/merge',
        body: {},
      })
    })

    test('open resolves file path to absolute', () => {
      const route = ccli.buildRoute(['open', 'src/App.tsx'], { line: '42' })
      expect(route.method).toBe('POST')
      expect(route.path).toBe('/open')
      expect(path.isAbsolute(route.body!.file as string)).toBe(true)
      expect(route.body!.line).toBe(42)
    })

    test('open without file returns error', () => {
      const route = ccli.buildRoute(['open'], {})
      expect(route.error).toBeTruthy()
    })

    test('diff resolves file path to absolute', () => {
      const route = ccli.buildRoute(['diff', 'src/App.tsx'], {})
      expect(route.method).toBe('POST')
      expect(route.path).toBe('/diff')
      expect(path.isAbsolute(route.body!.file as string)).toBe(true)
    })

    test('chat list maps to GET /chat/list', () => {
      const route = ccli.buildRoute(['chat', 'list'], {})
      expect(route).toEqual({ method: 'GET', path: '/chat/list' })
    })

    test('chat info with id adds query param', () => {
      const route = ccli.buildRoute(['chat', 'info', 'abc-123'], {})
      expect(route.method).toBe('GET')
      expect(route.path).toBe('/chat/info?id=abc-123')
    })

    test('chat info without id omits query param', () => {
      const route = ccli.buildRoute(['chat', 'info'], {})
      expect(route.method).toBe('GET')
      expect(route.path).toBe('/chat/info')
    })

    test('project list maps to GET /project/list', () => {
      const route = ccli.buildRoute(['project', 'list'], {})
      expect(route).toEqual({ method: 'GET', path: '/project/list' })
    })

    test('project create resolves path to absolute', () => {
      const route = ccli.buildRoute(['project', 'create', './my-project'], { name: 'My Project' })
      expect(route.method).toBe('POST')
      expect(route.path).toBe('/project/create')
      expect(path.isAbsolute(route.body!.path as string)).toBe(true)
      expect(route.body!.name).toBe('My Project')
    })

    test('project info with id', () => {
      const route = ccli.buildRoute(['project', 'info', 'proj-1'], {})
      expect(route.method).toBe('GET')
      expect(route.path).toBe('/project/info?id=proj-1')
    })

    test('sidecar create with title', () => {
      const route = ccli.buildRoute(['sidecar', 'create'], { title: 'Tests' })
      expect(route).toEqual({
        method: 'POST',
        path: '/sidecar/create',
        body: { title: 'Tests' },
      })
    })

    test('sidecar list maps to GET /sidecar/list', () => {
      const route = ccli.buildRoute(['sidecar', 'list'], {})
      expect(route).toEqual({ method: 'GET', path: '/sidecar/list' })
    })

    test('sidecar read with lines flag', () => {
      const route = ccli.buildRoute(['sidecar', 'read', 'sid-1'], { lines: '50' })
      expect(route.method).toBe('GET')
      expect(route.path).toBe('/sidecar/read/sid-1?lines=50')
    })

    test('sidecar exec maps correctly', () => {
      const route = ccli.buildRoute(['sidecar', 'exec', 'sid-1', 'npm test'], {})
      expect(route).toEqual({
        method: 'POST',
        path: '/sidecar/exec',
        body: { id: 'sid-1', command: 'npm test' },
      })
    })

    test('notify with title flag', () => {
      const route = ccli.buildRoute(['notify', 'Build done'], { title: 'CI' })
      expect(route).toEqual({
        method: 'POST',
        path: '/notify',
        body: { message: 'Build done', title: 'CI' },
      })
    })

    test('status maps correctly', () => {
      const route = ccli.buildRoute(['status', 'Running tests...'], {})
      expect(route).toEqual({
        method: 'POST',
        path: '/status',
        body: { message: 'Running tests...' },
      })
    })

    test('title maps correctly', () => {
      const route = ccli.buildRoute(['title', 'Auth refactor'], {})
      expect(route).toEqual({
        method: 'POST',
        path: '/title',
        body: { title: 'Auth refactor' },
      })
    })

    test('unknown group returns error', () => {
      const route = ccli.buildRoute(['foobar'], {})
      expect(route.error).toContain('Unknown command')
    })

    test('unknown worktree action returns error', () => {
      const route = ccli.buildRoute(['worktree', 'destroy'], {})
      expect(route.error).toContain('Unknown worktree action')
    })
  })

  // --- formatPretty ---

  describe('formatPretty', () => {
    test('formats object as key: value pairs', () => {
      const result = ccli.formatPretty({ id: 'abc', title: 'My Chat' })
      expect(result).toContain('id: abc')
      expect(result).toContain('title: My Chat')
    })

    test('formats array of objects', () => {
      const result = ccli.formatPretty([
        { id: '1', name: 'First' },
        { id: '2', name: 'Second' },
      ])
      expect(result).toContain('id: 1')
      expect(result).toContain('name: First')
      expect(result).toContain('id: 2')
      expect(result).toContain('name: Second')
    })

    test('handles null/undefined', () => {
      expect(ccli.formatPretty(null)).toBe('')
      expect(ccli.formatPretty(undefined)).toBe('')
    })

    test('handles primitive values', () => {
      expect(ccli.formatPretty('hello')).toBe('hello')
      expect(ccli.formatPretty(42)).toBe('42')
    })
  })

  // --- httpRequest (integration with real server) ---

  describe('httpRequest', () => {
    let server: http.Server
    let serverPort: number
    const testToken = 'test-token-abc'
    const testTerminalId = 'term-001'

    beforeAll(
      () =>
        new Promise<void>((resolve) => {
          server = http.createServer((req, res) => {
            // Collect body
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => {
              const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf-8') : ''

              // Echo back request details for verification
              const response = {
                ok: true,
                data: {
                  method: req.method,
                  url: req.url,
                  authHeader: req.headers['authorization'],
                  terminalIdHeader: req.headers['x-terminal-id'],
                  body: body ? JSON.parse(body) : null,
                },
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(response))
            })
          })

          server.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0
            resolve()
          })
        }),
    )

    afterAll(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    )

    test('sends correct POST request for worktree create', async () => {
      const env = { port: serverPort, terminalId: testTerminalId, token: testToken }
      const result = await ccli.httpRequest('POST', '/worktree/create', { name: 'foo' }, env)

      expect(result.statusCode).toBe(200)
      expect(result.body.ok).toBe(true)

      const data = result.body.data as Record<string, unknown>
      expect(data.method).toBe('POST')
      expect(data.url).toBe('/worktree/create')
      expect(data.authHeader).toBe('Bearer test-token-abc')
      expect(data.terminalIdHeader).toBe('term-001')
      expect(data.body).toEqual({ name: 'foo' })
    })

    test('sends correct GET request for chat list', async () => {
      const env = { port: serverPort, terminalId: testTerminalId, token: testToken }
      const result = await ccli.httpRequest('GET', '/chat/list', null, env)

      expect(result.statusCode).toBe(200)
      const data = result.body.data as Record<string, unknown>
      expect(data.method).toBe('GET')
      expect(data.url).toBe('/chat/list')
      expect(data.authHeader).toBe('Bearer test-token-abc')
    })

    test('sends correct POST with file path for open', async () => {
      const env = { port: serverPort, terminalId: testTerminalId, token: testToken }
      const absPath = path.resolve('src/App.tsx')
      const result = await ccli.httpRequest('POST', '/open', { file: absPath, line: 42 }, env)

      expect(result.statusCode).toBe(200)
      const data = result.body.data as Record<string, unknown>
      const body = data.body as Record<string, unknown>
      expect(body.file).toBe(absPath)
      expect(body.line).toBe(42)
    })
  })

  // --- httpRequest error handling ---

  describe('httpRequest errors', () => {
    let server: http.Server
    let serverPort: number

    beforeAll(
      () =>
        new Promise<void>((resolve) => {
          server = http.createServer((_req, res) => {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'Internal server error' }))
          })
          server.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0
            resolve()
          })
        }),
    )

    afterAll(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    )

    test('server error response is returned', async () => {
      const env = { port: serverPort, terminalId: 'term-1', token: 'tok' }
      const result = await ccli.httpRequest('POST', '/worktree/create', { name: 'x' }, env)

      expect(result.statusCode).toBe(500)
      expect(result.body.ok).toBe(false)
      expect(result.body.error).toBe('Internal server error')
    })

    test('connection refused throws descriptive error', async () => {
      const env = { port: 1, terminalId: 'term-1', token: 'tok' }
      await expect(ccli.httpRequest('GET', '/chat/list', null, env)).rejects.toThrow(
        /Failed to connect to Command server/,
      )
    })
  })

  // --- Missing env vars (process-level test using child_process) ---

  describe('missing env vars', () => {
    test('missing COMMAND_CENTER_PORT exits with error', async () => {
      const { execFile } = await import('node:child_process')
      const scriptPath = path.resolve(import.meta.dirname, '../electron/main/cli/ccli.cjs')

      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const proc = execFile(
          process.execPath,
          [scriptPath, 'chat', 'list'],
          {
            env: {
              // Omit COMMAND_CENTER_PORT, TERMINAL_ID, TOKEN
              PATH: process.env.PATH,
            },
          },
          (_err, _stdout, stderr) => {
            resolve({ code: proc.exitCode, stderr: stderr ?? '' })
          },
        )
      })

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('COMMAND_CENTER_PORT')
      expect(result.stderr).toContain('Command terminal')
    })
  })

  // --- Path resolution ---

  describe('path resolution', () => {
    test('open resolves relative path to absolute', () => {
      const route = ccli.buildRoute(['open', 'src/App.tsx'], {})
      expect(path.isAbsolute(route.body!.file as string)).toBe(true)
      expect((route.body!.file as string).endsWith('src' + path.sep + 'App.tsx')).toBe(true)
    })

    test('open preserves already-absolute path', () => {
      const absPath = path.resolve('/tmp/test-file.ts')
      const route = ccli.buildRoute(['open', absPath], {})
      expect(route.body!.file).toBe(absPath)
    })

    test('worktree link resolves relative path', () => {
      const route = ccli.buildRoute(['worktree', 'link', '../other-worktree'], {})
      expect(path.isAbsolute(route.body!.path as string)).toBe(true)
    })

    test('project create resolves relative path', () => {
      const route = ccli.buildRoute(['project', 'create', './my-proj'], { name: 'Test' })
      expect(path.isAbsolute(route.body!.path as string)).toBe(true)
    })
  })
})
