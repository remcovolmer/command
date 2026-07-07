import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../electron/main/services/Logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { CommandServer, type CommandResponse } from '../electron/main/services/CommandServer'

function request(options: {
  port: number
  method: string
  path: string
  token: string
  body?: Record<string, unknown>
  terminalId?: string
}): Promise<{ statusCode: number; body: CommandResponse }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
    }
    if (options.terminalId) headers['X-Terminal-ID'] = options.terminalId
    const bodyStr = options.body ? JSON.stringify(options.body) : undefined
    const req = http.request(
      { hostname: '127.0.0.1', port: options.port, path: options.path, method: options.method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')
          try {
            resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(raw) as CommandResponse })
          } catch {
            reject(new Error(`Failed to parse response: ${raw}`))
          }
        })
      }
    )
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

describe('CommandServer /open routing', () => {
  let server: CommandServer
  let sendSpy: ReturnType<typeof vi.fn>
  let projectDir: string

  beforeAll(async () => {
    server = new CommandServer()
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'cmd-open-proj-'))
    sendSpy = vi.fn()
    server.setDeps({
      terminalManager: { getTerminalInfo: (id: string) => ({ id, projectId: 'proj-1' }) } as never,
      projectPersistence: { getProjects: () => [{ id: 'proj-1', path: projectDir }] } as never,
      worktreeService: {} as never,
      githubService: {} as never,
      mainWindow: { webContents: { send: sendSpy } } as never,
    })
  })

  test('URL target sends editor:open-browser with the calling terminalId', async () => {
    const res = await request({
      port: server.getPort()!,
      method: 'POST',
      path: '/open',
      token: server.getToken(),
      body: { url: 'http://localhost:5173' },
      terminalId: 'term-A',
    })
    expect(res.statusCode).toBe(200)
    expect(sendSpy).toHaveBeenCalledWith('editor:open-browser', {
      url: 'http://localhost:5173',
      projectId: 'proj-1',
      terminalId: 'term-A',
    })
  })

  test('bare host URL target is normalized to http://', async () => {
    await request({
      port: server.getPort()!,
      method: 'POST',
      path: '/open',
      token: server.getToken(),
      body: { url: 'example.com' },
      terminalId: 'term-A',
    })
    expect(sendSpy).toHaveBeenCalledWith(
      'editor:open-browser',
      expect.objectContaining({ url: 'http://example.com' })
    )
  })

  test('URL target without X-Terminal-ID is rejected', async () => {
    const res = await request({
      port: server.getPort()!,
      method: 'POST',
      path: '/open',
      token: server.getToken(),
      body: { url: 'http://localhost:5173' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.body.ok).toBe(false)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  test('existing file target sends editor:open-file carrying the terminalId', async () => {
    const filePath = join(projectDir, 'report.html')
    writeFileSync(filePath, '<h1>hi</h1>', 'utf-8')
    const res = await request({
      port: server.getPort()!,
      method: 'POST',
      path: '/open',
      token: server.getToken(),
      body: { file: filePath },
      terminalId: 'term-A',
    })
    expect(res.statusCode).toBe(200)
    expect(sendSpy).toHaveBeenCalledWith(
      'editor:open-file',
      expect.objectContaining({ fileName: 'report.html', projectId: 'proj-1', terminalId: 'term-A' })
    )
  })

  test('non-existent file target returns "File not found"', async () => {
    const res = await request({
      port: server.getPort()!,
      method: 'POST',
      path: '/open',
      token: server.getToken(),
      body: { file: join(projectDir, 'nope.md') },
      terminalId: 'term-A',
    })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('File not found')
  })

  test('the /diff route has been removed (404)', async () => {
    const res = await request({
      port: server.getPort()!,
      method: 'POST',
      path: '/diff',
      token: server.getToken(),
      body: { file: join(projectDir, 'report.html') },
      terminalId: 'term-A',
    })
    expect(res.statusCode).toBe(404)
  })

  afterEach(() => {
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  })
})
