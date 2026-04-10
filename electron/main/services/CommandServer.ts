import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { TerminalManager } from './TerminalManager'
import type { ProjectPersistence } from './ProjectPersistence'
import type { WorktreeService } from './WorktreeService'
import type { GitHubService } from './GitHubService'

/** JSON response shape returned by all routes */
export interface CommandResponse {
  ok: boolean
  data?: unknown
  error?: string
}

/** Context passed to every route handler */
export interface RouteContext {
  terminalId: string | null
  terminalManager: TerminalManager
  projectPersistence: ProjectPersistence
  worktreeService: WorktreeService
  githubService: GitHubService
  mainWindow: BrowserWindow
}

/** Route handler function signature */
export type RouteHandler = (body: Record<string, unknown>, context: RouteContext) => Promise<CommandResponse>

/** Services required by CommandServer */
export interface CommandServerDeps {
  terminalManager: TerminalManager
  projectPersistence: ProjectPersistence
  worktreeService: WorktreeService
  githubService: GitHubService
  mainWindow: BrowserWindow
}

const MAX_BODY_SIZE = 1_048_576 // 1MB

export class CommandServer {
  private server: Server | null = null
  private port: number | null = null
  private readonly token: string
  private readonly routes: Map<string, RouteHandler> = new Map()
  private deps: CommandServerDeps | null = null

  constructor() {
    this.token = randomBytes(32).toString('hex')
  }

  /**
   * Set service dependencies. Called after all services are initialized.
   */
  setDeps(deps: CommandServerDeps): void {
    this.deps = deps
  }

  /**
   * Register a route handler.
   * @param method HTTP method (GET, POST, etc.)
   * @param path URL path (e.g., '/worktree/create')
   * @param handler Async function that processes the request
   */
  route(method: string, routePath: string, handler: RouteHandler): void {
    const key = `${method.toUpperCase()}:${routePath}`
    this.routes.set(key, handler)
  }

  /**
   * Start the HTTP server on a random port, bound to 127.0.0.1.
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err: unknown) => {
          console.error('[CommandServer] Unhandled error:', err)
          this.sendJson(res, 500, { ok: false, error: 'Internal server error' })
        })
      })

      this.server.on('error', (err: Error) => {
        console.error('[CommandServer] Server error:', err.message)
        reject(err)
      })

      // Listen on random port, localhost only
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address()
        if (address && typeof address === 'object') {
          this.port = address.port
          console.log(`[CommandServer] Listening on 127.0.0.1:${this.port}`)
        }
        resolve()
      })
    })
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        this.server = null
        this.port = null
        resolve()
      })
    })
  }

  /**
   * Get the port the server is listening on.
   */
  getPort(): number | null {
    return this.port
  }

  /**
   * Get the authentication token.
   */
  getToken(): string {
    return this.token
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS and method check
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Authenticate
    const authHeader = req.headers.authorization
    if (!authHeader) {
      this.sendJson(res, 401, { ok: false, error: 'Missing Authorization header' })
      return
    }

    if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== this.token) {
      this.sendJson(res, 401, { ok: false, error: 'Invalid token' })
      return
    }

    // Parse URL (strip query string for route matching)
    const urlParts = (req.url ?? '/').split('?')
    const pathname = urlParts[0]
    const method = (req.method ?? 'GET').toUpperCase()

    // Find route handler
    const routeKey = `${method}:${pathname}`
    const handler = this.routes.get(routeKey)
    if (!handler) {
      this.sendJson(res, 404, { ok: false, error: 'Route not found' })
      return
    }

    // Parse JSON body
    let body: Record<string, unknown> = {}
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const parseResult = await this.parseBody(req)
      if (parseResult.error) {
        this.sendJson(res, 400, { ok: false, error: parseResult.error })
        return
      }
      body = parseResult.body
    }

    // Check deps
    if (!this.deps) {
      this.sendJson(res, 503, { ok: false, error: 'Server not fully initialized' })
      return
    }

    // Build context
    const terminalId = typeof req.headers['x-terminal-id'] === 'string'
      ? req.headers['x-terminal-id']
      : null

    const context: RouteContext = {
      terminalId,
      terminalManager: this.deps.terminalManager,
      projectPersistence: this.deps.projectPersistence,
      worktreeService: this.deps.worktreeService,
      githubService: this.deps.githubService,
      mainWindow: this.deps.mainWindow,
    }

    // Execute handler
    try {
      const result = await handler(body, context)
      const statusCode = result.ok ? 200 : (result.error === 'Not found' ? 404 : 400)
      this.sendJson(res, statusCode, result)
    } catch (err: unknown) {
      console.error('[CommandServer] Route handler error:', err)
      this.sendJson(res, 500, { ok: false, error: 'Internal server error' })
    }
  }

  private async parseBody(req: IncomingMessage): Promise<{ body: Record<string, unknown>; error?: string }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_SIZE) {
          req.destroy()
          resolve({ body: {}, error: 'Request body too large' })
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        if (!raw || raw.trim().length === 0) {
          resolve({ body: {} })
          return
        }

        try {
          const parsed: unknown = JSON.parse(raw)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            resolve({ body: {}, error: 'Request body must be a JSON object' })
            return
          }
          resolve({ body: parsed as Record<string, unknown> })
        } catch {
          resolve({ body: {}, error: 'Invalid JSON in request body' })
        }
      })

      req.on('error', () => {
        resolve({ body: {}, error: 'Error reading request body' })
      })
    })
  }

  private sendJson(res: ServerResponse, statusCode: number, data: CommandResponse): void {
    const json = JSON.stringify(data)
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    })
    res.end(json)
  }
}
