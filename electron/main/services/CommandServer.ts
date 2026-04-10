import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, accessSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { Notification, type BrowserWindow } from 'electron'
import type { TerminalManager } from './TerminalManager'
import type { ProjectPersistence } from './ProjectPersistence'
import type { WorktreeService } from './WorktreeService'
import type { GitHubService } from './GitHubService'

/** JSON response shape returned by all routes */
export interface CommandResponse {
  ok: boolean
  data?: unknown
  error?: string
  statusCode?: number
}

/** Context passed to every route handler */
export interface RouteContext {
  terminalId: string | null
  terminalManager: TerminalManager
  projectPersistence: ProjectPersistence
  worktreeService: WorktreeService
  githubService: GitHubService
  mainWindow: BrowserWindow
  /** Parsed query-string parameters from the request URL */
  query: URLSearchParams
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id)
}

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
    this.registerWorktreeRoutes()
    this.registerSidecarRoutes()
    this.registerFileRoutes()
    this.registerQueryRoutes()
    this.registerFeedbackRoutes()
  }

  /**
   * Register worktree-related route handlers.
   */
  private registerWorktreeRoutes(): void {
    this.route('POST', '/worktree/create', async (body, context) => {
      // Validate required fields
      const name = body.name
      if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
        return { ok: false, error: 'Missing or invalid "name" (string, 1-200 chars)' }
      }
      if (/[/\\]|\.\./.test(name)) {
        return { ok: false, error: 'Name must not contain path separators or ".."' }
      }

      const branch = body.branch
      if (branch !== undefined && (typeof branch !== 'string' || branch.length === 0 || branch.length > 200)) {
        return { ok: false, error: 'Invalid "branch" (string, 1-200 chars)' }
      }
      if (typeof branch === 'string' && branch.startsWith('-')) {
        return { ok: false, error: 'Branch name must not start with "-"' }
      }

      const sourceBranch = body.sourceBranch
      if (sourceBranch !== undefined && (typeof sourceBranch !== 'string' || sourceBranch.length === 0 || sourceBranch.length > 200)) {
        return { ok: false, error: 'Invalid "sourceBranch" (string, 1-200 chars)' }
      }
      if (typeof sourceBranch === 'string' && sourceBranch.startsWith('-')) {
        return { ok: false, error: 'Source branch name must not start with "-"' }
      }

      // Resolve project from terminal context
      const { terminalId } = context
      if (!terminalId) {
        return { ok: false, error: 'Missing X-Terminal-ID header' }
      }

      const terminalInfo = context.terminalManager.getTerminalInfo(terminalId)
      if (!terminalInfo) {
        return { ok: false, error: 'Terminal not found' }
      }

      const projectId = terminalInfo.projectId
      const projects = context.projectPersistence.getProjects()
      const project = projects.find(p => p.id === projectId)
      if (!project) {
        return { ok: false, error: 'Project not found' }
      }

      // Create worktree via git
      const branchName = typeof branch === 'string' ? branch : name
      const result = await context.worktreeService.createWorktree(
        project.path,
        branchName,
        name,
        typeof sourceBranch === 'string' ? sourceBranch : undefined,
      )

      // Register in persistence
      const worktreeId = randomUUID()
      const worktree = context.projectPersistence.addWorktree({
        id: worktreeId,
        projectId,
        name,
        branch: result.branch,
        path: result.path,
        createdAt: Date.now(),
        isLocked: false,
      })

      // Update terminal's worktree assignment
      const updateResult = context.terminalManager.updateTerminalWorktree(terminalId, worktree.id, worktree.path)
      if (!updateResult.success) {
        return { ok: false, error: updateResult.error ?? 'Failed to assign worktree to terminal' }
      }

      // Notify renderer
      context.mainWindow.webContents.send('worktree:added', projectId, worktree)

      return {
        ok: true,
        data: { worktreeId: worktree.id, path: worktree.path, branch: worktree.branch },
      }
    })

    this.route('POST', '/worktree/link', async (body, context) => {
      // Validate required fields
      const worktreePath = body.path
      if (typeof worktreePath !== 'string' || worktreePath.length === 0 || worktreePath.length > 1000) {
        return { ok: false, error: 'Missing or invalid "path" (absolute path string)' }
      }

      // Resolve project from terminal context
      const { terminalId } = context
      if (!terminalId) {
        return { ok: false, error: 'Missing X-Terminal-ID header' }
      }

      const terminalInfo = context.terminalManager.getTerminalInfo(terminalId)
      if (!terminalInfo) {
        return { ok: false, error: 'Terminal not found' }
      }

      const projectId = terminalInfo.projectId
      const projects = context.projectPersistence.getProjects()
      const project = projects.find(p => p.id === projectId)
      if (!project) {
        return { ok: false, error: 'Project not found' }
      }

      // Validate path is under project's .worktrees/ directory
      if (!context.worktreeService.isWorktreePath(project.path, worktreePath)) {
        return { ok: false, error: 'Path is not under the project .worktrees/ directory' }
      }

      // Validate it's a git worktree by reading the .git file
      let gitFileContent: string
      try {
        gitFileContent = readFileSync(`${worktreePath}/.git`, 'utf-8').trim()
      } catch {
        return { ok: false, error: 'Path is not a valid git worktree (no .git file)' }
      }

      if (!gitFileContent.startsWith('gitdir:')) {
        return { ok: false, error: 'Path is not a valid git worktree (.git is not a gitdir reference)' }
      }

      // Extract branch name by reading HEAD from the gitdir
      // Security: validate gitdir resolves within the project's .git/worktrees/ to prevent
      // arbitrary file reads via crafted .git files (e.g., UNC paths on Windows → SMB hash leak)
      let branchName = 'unknown'
      try {
        const gitdir = gitFileContent.replace('gitdir:', '').trim()
        const resolvedGitdir = path.resolve(path.normalize(gitdir))
        const projectGitDir = path.resolve(project.path, '.git')
        const isWin = process.platform === 'win32'
        const normalizedGitdir = isWin ? resolvedGitdir.toLowerCase() : resolvedGitdir
        const normalizedProjectGit = isWin ? projectGitDir.toLowerCase() : projectGitDir
        if (!normalizedGitdir.startsWith(normalizedProjectGit + path.sep) && normalizedGitdir !== normalizedProjectGit) {
          return { ok: false, error: 'Worktree gitdir points outside the project — refusing to read' }
        }

        const headContent = readFileSync(path.join(resolvedGitdir, 'HEAD'), 'utf-8').trim()
        if (headContent.startsWith('ref: refs/heads/')) {
          branchName = headContent.replace('ref: refs/heads/', '')
        } else {
          branchName = headContent.slice(0, 8) // short SHA for detached HEAD
        }
      } catch {
        // Keep 'unknown' if we can't read HEAD
      }

      // Extract worktree name from directory name
      const worktreeName = worktreePath.split(/[/\\]/).filter(Boolean).pop() ?? 'unknown'

      // Register in persistence
      const worktreeId = randomUUID()
      const worktree = context.projectPersistence.addWorktree({
        id: worktreeId,
        projectId,
        name: worktreeName,
        branch: branchName,
        path: worktreePath,
        createdAt: Date.now(),
        isLocked: false,
      })

      // Update terminal's worktree assignment
      const updateResult = context.terminalManager.updateTerminalWorktree(terminalId, worktree.id, worktree.path)
      if (!updateResult.success) {
        return { ok: false, error: updateResult.error ?? 'Failed to assign worktree to terminal' }
      }

      // Notify renderer
      context.mainWindow.webContents.send('worktree:added', projectId, worktree)

      return {
        ok: true,
        data: { worktreeId: worktree.id, path: worktree.path, branch: worktree.branch },
      }
    })

    this.route('POST', '/worktree/merge', async (_body, context) => {
      // Resolve terminal and worktree
      const { terminalId } = context
      if (!terminalId) {
        return { ok: false, error: 'Missing X-Terminal-ID header' }
      }

      const terminalInfo = context.terminalManager.getTerminalInfo(terminalId)
      if (!terminalInfo) {
        return { ok: false, error: 'Terminal not found' }
      }

      const worktreeId = terminalInfo.worktreeId
      if (!worktreeId) {
        return { ok: false, error: 'Terminal is not associated with a worktree' }
      }

      if (!isValidUUID(worktreeId)) {
        return { ok: false, error: 'Invalid worktree ID' }
      }

      const worktree = context.projectPersistence.getWorktreeById(worktreeId)
      if (!worktree) {
        return { ok: false, error: 'Worktree not found' }
      }

      // Look up project path
      const projects = context.projectPersistence.getProjects()
      const project = projects.find(p => p.id === worktree.projectId)
      if (!project) {
        return { ok: false, error: 'Project not found' }
      }

      // Find PR for branch
      const pr = await context.githubService.getPRForBranch(project.path, worktree.branch)
      if (!pr) {
        return { ok: false, error: `No open PR found for branch "${worktree.branch}"` }
      }

      // Check for uncommitted changes
      const hasChanges = await context.worktreeService.hasUncommittedChanges(worktree.path)
      if (hasChanges) {
        return { ok: false, error: 'Worktree has uncommitted changes. Commit or stash before merging.' }
      }

      // Merge the PR
      await context.githubService.mergePR(project.path, pr.number)

      return {
        ok: true,
        data: { merged: true, prNumber: pr.number, prUrl: pr.url, branch: worktree.branch },
      }
    })
  }

  /**
   * Validate that a file path is within a project or worktree boundary.
   * Returns the resolved path or a CommandResponse error.
   */
  private validateFilePath(filePath: unknown, context: RouteContext): { ok: true; resolved: string; projectId: string } | CommandResponse {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1000) {
      return { ok: false, error: 'Missing or invalid "file" (absolute path string)' }
    }
    const resolved = path.resolve(path.normalize(filePath))
    const projects = context.projectPersistence.getProjects()

    // Case-insensitive comparison on Windows
    const isWin = process.platform === 'win32'
    const normalizedResolved = isWin ? resolved.toLowerCase() : resolved

    for (const p of projects) {
      const projectPath = path.resolve(p.path)
      const normalizedProject = isWin ? projectPath.toLowerCase() : projectPath
      if (normalizedResolved.startsWith(normalizedProject + path.sep) || normalizedResolved === normalizedProject) {
        return { ok: true as const, resolved, projectId: p.id }
      }
    }
    return { ok: false, error: 'File path is not within a registered project' }
  }

  /**
   * Register file-related route handlers (Unit 6).
   */
  private registerFileRoutes(): void {
    // POST /open — open a file in the editor
    this.route('POST', '/open', async (body, context) => {
      const file = body.file
      const validation = this.validateFilePath(file, context)
      if (!validation.ok) return validation

      const line = body.line
      if (line !== undefined && (typeof line !== 'number' || !Number.isInteger(line) || line < 1)) {
        return { ok: false, error: 'Invalid "line" (positive integer)' }
      }

      // Verify file exists
      try {
        accessSync(validation.resolved)
      } catch {
        return { ok: false, error: 'File not found' }
      }

      context.mainWindow.webContents.send('editor:open-file', {
        filePath: validation.resolved,
        fileName: path.basename(validation.resolved),
        projectId: validation.projectId,
        line: line as number | undefined,
      })

      return { ok: true }
    })

    // POST /diff — open a diff view for a file
    this.route('POST', '/diff', async (body, context) => {
      const file = body.file
      const validation = this.validateFilePath(file, context)
      if (!validation.ok) return validation

      // Verify file exists
      try {
        accessSync(validation.resolved)
      } catch {
        return { ok: false, error: 'File not found' }
      }

      context.mainWindow.webContents.send('editor:open-diff', {
        filePath: validation.resolved,
        fileName: path.basename(validation.resolved),
        projectId: validation.projectId,
      })

      return { ok: true }
    })
  }

  /**
   * Register chat & project query route handlers (Unit 8).
   */
  private registerQueryRoutes(): void {
    // GET /chat/list — list all chats for the caller's project
    this.route('GET', '/chat/list', async (_body, context) => {
      const resolved = this.resolveCallerContext(context)
      if ('ok' in resolved) return resolved

      const { projectId } = resolved
      const allTerminals = context.terminalManager.getAllTerminals()
      const projectTerminals = allTerminals.filter(t => t.projectId === projectId)

      return {
        ok: true,
        data: {
          chats: projectTerminals.map(t => ({
            id: t.id,
            title: t.title ?? null,
            state: t.state,
            worktreeId: t.worktreeId ?? null,
            type: t.type,
            lastActivity: Date.now(),
          })),
        },
      }
    })

    // GET /chat/info — get info about a specific chat
    this.route('GET', '/chat/info', async (_body, context) => {
      const targetId = context.query.get('id') ?? context.terminalId
      if (!targetId) {
        return { ok: false, error: 'Missing "id" query parameter or X-Terminal-ID header' }
      }

      const terminalInfo = context.terminalManager.getTerminalInfo(targetId)
      if (!terminalInfo) {
        return { ok: false, error: 'Not found', statusCode: 404 }
      }

      let worktreePath: string | null = null
      if (terminalInfo.worktreeId) {
        const worktree = context.projectPersistence.getWorktreeById(terminalInfo.worktreeId)
        if (worktree) {
          worktreePath = worktree.path
        }
      }

      return {
        ok: true,
        data: {
          id: targetId,
          title: terminalInfo.title ?? null,
          state: terminalInfo.state,
          worktreeId: terminalInfo.worktreeId ?? null,
          worktreePath,
          type: terminalInfo.type,
          projectId: terminalInfo.projectId,
        },
      }
    })

    // GET /project/list — list all projects
    this.route('GET', '/project/list', async (_body, context) => {
      const projects = context.projectPersistence.getProjects()
      const allWorktrees = context.projectPersistence.getAllWorktrees()
      const allTerminals = context.terminalManager.getAllTerminals()

      return {
        ok: true,
        data: {
          projects: projects.map(p => ({
            id: p.id,
            name: p.name,
            path: p.path,
            terminalCount: allTerminals.filter(t => t.projectId === p.id).length,
            worktreeCount: (allWorktrees[p.id] ?? []).length,
          })),
        },
      }
    })

    // POST /project/create — create a new project
    this.route('POST', '/project/create', async (body, context) => {
      const projectPath = body.path
      if (typeof projectPath !== 'string' || projectPath.length === 0 || projectPath.length > 1000) {
        return { ok: false, error: 'Missing or invalid "path" (absolute path string)' }
      }

      // Validate path exists and is a directory
      try {
        const stat = statSync(projectPath)
        if (!stat.isDirectory()) {
          return { ok: false, error: 'Path is not a directory' }
        }
      } catch {
        return { ok: false, error: 'Path does not exist' }
      }

      // Security: require the path to be a git repository to prevent registering
      // arbitrary directories (which would expand validateFilePath's readable surface)
      try {
        accessSync(path.join(projectPath, '.git'))
      } catch {
        return { ok: false, error: 'Path is not a git repository (no .git found)' }
      }

      const name = typeof body.name === 'string' && body.name.length > 0 && body.name.length <= 200
        ? body.name
        : path.basename(projectPath)

      const project = context.projectPersistence.addProject(projectPath, name)

      return {
        ok: true,
        data: { projectId: project.id, name: project.name, path: project.path },
      }
    })

    // GET /project/info — get info about a specific project
    this.route('GET', '/project/info', async (_body, context) => {
      let projectId = context.query.get('id')
      if (!projectId) {
        // Default to caller's project
        const resolved = this.resolveCallerContext(context)
        if ('ok' in resolved) return resolved
        projectId = resolved.projectId
      }

      const projects = context.projectPersistence.getProjects()
      const project = projects.find(p => p.id === projectId)
      if (!project) {
        return { ok: false, error: 'Not found', statusCode: 404 }
      }

      const worktrees = context.projectPersistence.getWorktrees(projectId)
      const allTerminals = context.terminalManager.getAllTerminals()
      const terminalCount = allTerminals.filter(t => t.projectId === projectId).length

      return {
        ok: true,
        data: {
          id: project.id,
          name: project.name,
          path: project.path,
          terminalCount,
          worktrees: worktrees.map(w => ({
            id: w.id,
            name: w.name,
            branch: w.branch,
            path: w.path,
          })),
        },
      }
    })
  }

  /**
   * Register feedback route handlers (Unit 9).
   */
  private registerFeedbackRoutes(): void {
    // POST /notify — show a desktop notification
    this.route('POST', '/notify', async (body) => {
      const message = body.message
      if (typeof message !== 'string' || message.length === 0 || message.length > 5000) {
        return { ok: false, error: 'Missing or invalid "message" (non-empty string, max 5000 chars)' }
      }
      const title = typeof body.title === 'string' && body.title.length > 0 && body.title.length <= 200
        ? body.title
        : 'Command'

      new Notification({ title, body: message }).show()
      return { ok: true }
    })

    // POST /status — send a status message to the renderer
    this.route('POST', '/status', async (body, context) => {
      const { terminalId } = context
      if (!terminalId) {
        return { ok: false, error: 'Missing X-Terminal-ID header' }
      }

      const message = body.message
      if (typeof message !== 'string' || message.length === 0 || message.length > 5000) {
        return { ok: false, error: 'Missing or invalid "message" (non-empty string, max 5000 chars)' }
      }

      context.mainWindow.webContents.send('terminal:status', terminalId, message)
      return { ok: true }
    })

    // POST /title — update the terminal title
    this.route('POST', '/title', async (body, context) => {
      const { terminalId } = context
      if (!terminalId) {
        return { ok: false, error: 'Missing X-Terminal-ID header' }
      }

      const title = body.title
      if (typeof title !== 'string' || title.length === 0 || title.length > 200) {
        return { ok: false, error: 'Missing or invalid "title" (non-empty string, max 200 chars)' }
      }

      context.terminalManager.setTerminalTitle(terminalId, title)
      return { ok: true }
    })
  }

  /**
   * Validate that a sidecar terminal exists and belongs to the caller's project/worktree context.
   * Returns null if ownership is valid, or a CommandResponse error.
   */
  private validateSidecarOwnership(
    sidecarId: string,
    projectId: string,
    worktreeId: string | undefined,
    context: RouteContext,
  ): CommandResponse | null {
    const sidecarInfo = context.terminalManager.getTerminalInfo(sidecarId)
    if (!sidecarInfo) return { ok: false, error: 'Sidecar terminal not found' }
    if (sidecarInfo.type !== 'normal') return { ok: false, error: 'Terminal is not a sidecar' }
    if (sidecarInfo.projectId !== projectId) return { ok: false, error: 'Sidecar does not belong to your project' }
    if (worktreeId) {
      if (sidecarInfo.worktreeId !== worktreeId) return { ok: false, error: 'Sidecar does not belong to your worktree context' }
    } else {
      if (sidecarInfo.worktreeId) return { ok: false, error: 'Sidecar does not belong to your project context' }
    }
    return null
  }

  /**
   * Resolve the caller's project/worktree context from X-Terminal-ID header.
   * Returns context info or a CommandResponse error.
   */
  private resolveCallerContext(context: RouteContext): { projectId: string; worktreeId: string | undefined; contextKey: string } | CommandResponse {
    const { terminalId } = context
    if (!terminalId) {
      return { ok: false, error: 'Missing X-Terminal-ID header' }
    }
    const terminalInfo = context.terminalManager.getTerminalInfo(terminalId)
    if (!terminalInfo) {
      return { ok: false, error: 'Terminal not found' }
    }
    const projectId = terminalInfo.projectId
    const worktreeId = terminalInfo.worktreeId
    const contextKey = worktreeId ?? projectId
    return { projectId, worktreeId, contextKey }
  }

  /**
   * Register sidecar terminal route handlers.
   */
  private registerSidecarRoutes(): void {
    // POST /sidecar/create — create a new sidecar terminal in the caller's context
    this.route('POST', '/sidecar/create', async (body, context) => {
      const resolved = this.resolveCallerContext(context)
      if ('ok' in resolved) return resolved
      const { projectId, worktreeId, contextKey } = resolved

      // Check existing sidecar count for this context
      const existing = context.terminalManager.getTerminalsByContext(projectId, worktreeId, 'normal')
      if (existing.length >= 5) {
        return { ok: false, error: 'Sidecar limit reached (max 5 per context)' }
      }

      // Resolve cwd from project/worktree
      let cwd: string
      if (worktreeId) {
        const worktree = context.projectPersistence.getWorktreeById(worktreeId)
        if (!worktree) {
          return { ok: false, error: 'Worktree not found' }
        }
        cwd = worktree.path
      } else {
        const projects = context.projectPersistence.getProjects()
        const project = projects.find(p => p.id === projectId)
        if (!project) {
          return { ok: false, error: 'Project not found' }
        }
        cwd = project.path
      }

      const title = typeof body.title === 'string' && body.title.length > 0 && body.title.length <= 200
        ? body.title
        : 'Terminal'

      const terminalId = context.terminalManager.createTerminal({
        cwd,
        type: 'normal',
        initialTitle: title,
        projectId,
        worktreeId,
      })

      // Notify renderer to register the sidecar terminal
      context.mainWindow.webContents.send('sidecar:created', contextKey, {
        id: terminalId,
        projectId,
        worktreeId: worktreeId ?? null,
        state: 'done',
        lastActivity: Date.now(),
        title,
        type: 'normal',
      })

      return {
        ok: true,
        data: { id: terminalId, title },
      }
    })

    // GET /sidecar/list — list sidecar terminals in the caller's context
    this.route('GET', '/sidecar/list', async (_body, context) => {
      const resolved = this.resolveCallerContext(context)
      if ('ok' in resolved) return resolved
      const { projectId, worktreeId } = resolved

      const sidecars = context.terminalManager.getTerminalsByContext(projectId, worktreeId, 'normal')

      return {
        ok: true,
        data: {
          sidecars: sidecars.map(s => ({
            id: s.id,
            title: s.title ?? 'Terminal',
            lastActivity: s.lastActivity,
          })),
        },
      }
    })

    // GET /sidecar/read?id=...&lines=... — read output from a sidecar terminal
    this.route('GET', '/sidecar/read', async (_body, context) => {
      const resolved = this.resolveCallerContext(context)
      if ('ok' in resolved) return resolved
      const { projectId, worktreeId } = resolved

      const sidecarId = context.query.get('id')
      if (!sidecarId || !isValidUUID(sidecarId)) {
        return { ok: false, error: 'Missing or invalid "id" query parameter' }
      }

      // Validate that the sidecar belongs to the caller's context
      const ownershipError = this.validateSidecarOwnership(sidecarId, projectId, worktreeId, context)
      if (ownershipError) return ownershipError

      const linesParam = context.query.get('lines')
      const lines = linesParam ? Math.max(1, Math.min(10000, parseInt(linesParam, 10) || 100)) : 100

      const buffer = context.terminalManager.getSidecarBuffer(sidecarId) ?? ''
      const allLines = buffer.split('\n')
      const totalLines = allLines.length
      const output = allLines.slice(-lines).join('\n')

      return {
        ok: true,
        data: { output, totalLines },
      }
    })

    // POST /sidecar/exec — execute a command in a sidecar terminal
    this.route('POST', '/sidecar/exec', async (body, context) => {
      const resolved = this.resolveCallerContext(context)
      if ('ok' in resolved) return resolved
      const { projectId, worktreeId } = resolved

      const sidecarId = body.id
      if (typeof sidecarId !== 'string' || !isValidUUID(sidecarId)) {
        return { ok: false, error: 'Missing or invalid "id" (UUID string)' }
      }

      const command = body.command
      if (typeof command !== 'string' || command.length === 0 || command.length > 10000) {
        return { ok: false, error: 'Missing or invalid "command" (string, 1-10000 chars)' }
      }

      // Validate that the sidecar belongs to the caller's context
      const ownershipError = this.validateSidecarOwnership(sidecarId, projectId, worktreeId, context)
      if (ownershipError) return ownershipError

      const success = context.terminalManager.writeToPty(sidecarId, command + '\n')
      if (!success) {
        return { ok: false, error: 'Failed to write to sidecar PTY' }
      }

      return { ok: true }
    })
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
        // Replace startup error handler with runtime handler
        this.server!.removeAllListeners('error')
        this.server!.on('error', (err: Error) => {
          console.error('[CommandServer] Runtime server error:', err.message)
        })

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
      this.server.closeAllConnections()
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
    const queryString = urlParts[1] ?? ''
    const query = new URLSearchParams(queryString)
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
      query,
    }

    // Execute handler
    try {
      const result = await handler(body, context)
      const statusCode = result.ok ? 200 : (result.statusCode ?? 400)
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
      let resolved = false

      req.on('data', (chunk: Buffer) => {
        if (resolved) return
        size += chunk.length
        if (size > MAX_BODY_SIZE) {
          resolved = true
          req.destroy()
          resolve({ body: {}, error: 'Request body too large' })
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => {
        if (resolved) return
        resolved = true
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
        if (resolved) return
        resolved = true
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
