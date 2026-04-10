import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { CommandServer, type CommandResponse, type RouteHandler } from '../electron/main/services/CommandServer'

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

describe('CommandServer', () => {
  let server: CommandServer

  beforeAll(async () => {
    server = new CommandServer()
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  // --- Lifecycle ---

  describe('lifecycle', () => {
    test('starts on a random port', () => {
      const port = server.getPort()
      expect(port).toBeTypeOf('number')
      expect(port).toBeGreaterThan(0)
      expect(port).toBeLessThanOrEqual(65535)
    })

    test('port and token are accessible via getters', () => {
      expect(server.getPort()).toBeTypeOf('number')
      expect(server.getToken()).toBeTypeOf('string')
      expect(server.getToken().length).toBe(64) // 32 bytes = 64 hex chars
    })

    test('token is unique per instance', () => {
      const other = new CommandServer()
      expect(other.getToken()).not.toBe(server.getToken())
    })

    test('stop clears port', async () => {
      const temp = new CommandServer()
      await temp.start()
      expect(temp.getPort()).toBeTypeOf('number')
      await temp.stop()
      expect(temp.getPort()).toBeNull()
    })
  })

  // --- Authentication ---

  describe('authentication', () => {
    test('valid Bearer token passes auth (200)', async () => {
      const echoHandler: RouteHandler = async (body) => ({ ok: true, data: body })
      server.route('POST', '/test/echo', echoHandler)

      // Need deps for 200 — use a handler that doesn't use context services
      // The server will return 503 if deps are not set, so set minimal deps
      server.setDeps({
        terminalManager: {} as never,
        projectPersistence: {} as never,
        worktreeService: {} as never,
        githubService: {} as never,
        mainWindow: {} as never,
      })

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/test/echo',
        token: server.getToken(),
        body: { hello: 'world' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.data).toEqual({ hello: 'world' })
    })

    test('missing Authorization header returns 401', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/test/echo',
      })

      expect(res.statusCode).toBe(401)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Missing Authorization header')
    })

    test('invalid token returns 401', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/test/echo',
        token: 'wrong-token-value',
      })

      expect(res.statusCode).toBe(401)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Invalid token')
    })

    test('malformed Bearer header returns 401', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/test/echo',
        headers: { Authorization: 'Basic abc123' },
      })

      expect(res.statusCode).toBe(401)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Invalid token')
    })
  })

  // --- Routing ---

  describe('routing', () => {
    beforeEach(() => {
      server.setDeps({
        terminalManager: {} as never,
        projectPersistence: {} as never,
        worktreeService: {} as never,
        githubService: {} as never,
        mainWindow: {} as never,
      })
    })

    test('unknown route returns 404', async () => {
      const res = await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/does-not-exist',
        token: server.getToken(),
      })

      expect(res.statusCode).toBe(404)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Route not found')
    })

    test('GET route receives empty body', async () => {
      let receivedBody: Record<string, unknown> = {}
      server.route('GET', '/test/get', async (body) => {
        receivedBody = body
        return { ok: true }
      })

      const res = await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/test/get',
        token: server.getToken(),
      })

      expect(res.statusCode).toBe(200)
      expect(receivedBody).toEqual({})
    })

    test('POST route receives parsed JSON body', async () => {
      let receivedBody: Record<string, unknown> = {}
      server.route('POST', '/test/body', async (body) => {
        receivedBody = body
        return { ok: true }
      })

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/test/body',
        token: server.getToken(),
        body: { name: 'test', count: 42 },
      })

      expect(res.statusCode).toBe(200)
      expect(receivedBody).toEqual({ name: 'test', count: 42 })
    })

    test('X-Terminal-ID header is passed in context', async () => {
      let receivedTerminalId: string | null = null
      server.route('GET', '/test/terminal-id', async (_body, ctx) => {
        receivedTerminalId = ctx.terminalId
        return { ok: true }
      })

      await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/test/terminal-id',
        token: server.getToken(),
        headers: { 'X-Terminal-ID': 'abc-123' },
      })

      expect(receivedTerminalId).toBe('abc-123')
    })

    test('handler returning ok: false gets non-200 status', async () => {
      server.route('POST', '/test/fail', async () => {
        return { ok: false, error: 'Something went wrong' }
      })

      const res = await request({
        port: server.getPort()!,
        method: 'POST',
        path: '/test/fail',
        token: server.getToken(),
        body: {},
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Something went wrong')
    })
  })

  // --- Body parsing ---

  describe('body parsing', () => {
    beforeEach(() => {
      server.setDeps({
        terminalManager: {} as never,
        projectPersistence: {} as never,
        worktreeService: {} as never,
        githubService: {} as never,
        mainWindow: {} as never,
      })
    })

    test('malformed JSON body returns 400', async () => {
      server.route('POST', '/test/parse', async () => ({ ok: true }))

      // Send raw invalid JSON
      const res = await new Promise<{ statusCode: number; body: CommandResponse }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: server.getPort()!,
            path: '/test/parse',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${server.getToken()}`,
            },
          },
          (httpRes) => {
            const chunks: Buffer[] = []
            httpRes.on('data', (chunk: Buffer) => chunks.push(chunk))
            httpRes.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf-8')
              resolve({
                statusCode: httpRes.statusCode ?? 0,
                body: JSON.parse(raw) as CommandResponse,
              })
            })
          },
        )
        req.on('error', reject)
        req.write('{not valid json}')
        req.end()
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Invalid JSON in request body')
    })

    test('empty POST body is accepted as empty object', async () => {
      let receivedBody: Record<string, unknown> = { sentinel: true }
      server.route('POST', '/test/empty', async (body) => {
        receivedBody = body
        return { ok: true }
      })

      // Send POST with no body
      const res = await new Promise<{ statusCode: number; body: CommandResponse }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: server.getPort()!,
            path: '/test/empty',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${server.getToken()}`,
              'Content-Length': '0',
            },
          },
          (httpRes) => {
            const chunks: Buffer[] = []
            httpRes.on('data', (chunk: Buffer) => chunks.push(chunk))
            httpRes.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf-8')
              resolve({
                statusCode: httpRes.statusCode ?? 0,
                body: JSON.parse(raw) as CommandResponse,
              })
            })
          },
        )
        req.on('error', reject)
        req.end()
      })

      expect(res.statusCode).toBe(200)
      expect(receivedBody).toEqual({})
    })

    test('array body returns 400', async () => {
      server.route('POST', '/test/array', async () => ({ ok: true }))

      const res = await new Promise<{ statusCode: number; body: CommandResponse }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: server.getPort()!,
            path: '/test/array',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${server.getToken()}`,
            },
          },
          (httpRes) => {
            const chunks: Buffer[] = []
            httpRes.on('data', (chunk: Buffer) => chunks.push(chunk))
            httpRes.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf-8')
              resolve({
                statusCode: httpRes.statusCode ?? 0,
                body: JSON.parse(raw) as CommandResponse,
              })
            })
          },
        )
        req.on('error', reject)
        req.write('[1, 2, 3]')
        req.end()
      })

      expect(res.statusCode).toBe(400)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Request body must be a JSON object')
    })
  })

  // --- Error handling ---

  describe('error handling', () => {
    beforeEach(() => {
      server.setDeps({
        terminalManager: {} as never,
        projectPersistence: {} as never,
        worktreeService: {} as never,
        githubService: {} as never,
        mainWindow: {} as never,
      })
    })

    test('handler throwing an error returns 500', async () => {
      server.route('GET', '/test/throw', async () => {
        throw new Error('Unexpected failure')
      })

      const res = await request({
        port: server.getPort()!,
        method: 'GET',
        path: '/test/throw',
        token: server.getToken(),
      })

      expect(res.statusCode).toBe(500)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toBe('Internal server error')
    })

    test('returns 503 when deps are not set', async () => {
      const temp = new CommandServer()
      temp.route('GET', '/test/nodeps', async () => ({ ok: true }))
      await temp.start()

      try {
        const res = await request({
          port: temp.getPort()!,
          method: 'GET',
          path: '/test/nodeps',
          token: temp.getToken(),
        })

        expect(res.statusCode).toBe(503)
        expect(res.body.ok).toBe(false)
        expect(res.body.error).toBe('Server not fully initialized')
      } finally {
        await temp.stop()
      }
    })
  })
})
