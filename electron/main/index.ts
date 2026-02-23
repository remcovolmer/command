import { app, BrowserWindow, shell, ipcMain, dialog, Notification, Menu, powerMonitor } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { TerminalManager } from './services/TerminalManager'
import { ProjectPersistence, type PersistedSession } from './services/ProjectPersistence'
import { GitService } from './services/GitService'
import { WorktreeService } from './services/WorktreeService'
import { ClaudeHookWatcher } from './services/ClaudeHookWatcher'
import { installClaudeHooks } from './services/HookInstaller'
import { UpdateService } from './services/UpdateService'
import { GitHubService } from './services/GitHubService'
import { TaskService } from './services/TaskService'
import { FileWatcherService } from './services/FileWatcherService'
import { AutomationService } from './services/AutomationService'
import { randomUUID } from 'node:crypto'

// Validation helpers
const isValidUUID = (id: string): boolean =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(val)))

function validateProjectPath(projectPath: string): void {
  if (typeof projectPath !== 'string' || projectPath.length === 0 || projectPath.length > 1000) {
    throw new Error('Invalid project path')
  }
}

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId('com.remcovolmer.command')

// Use separate userData folder for dev mode to allow running alongside production
if (VITE_DEV_SERVER_URL) {
  const devUserData = path.join(app.getPath('userData'), '-dev')
  app.setPath('userData', devUserData)
}

// Prevent Chromium from throttling timers when window is minimized (needed for cron schedulers)
app.commandLine.appendSwitch('disable-background-timer-throttling')

// Skip single instance lock in test mode to allow Playwright to launch multiple instances
if (process.env.NODE_ENV !== 'test' && !app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let terminalManager: TerminalManager | null = null
let projectPersistence: ProjectPersistence | null = null
let gitService: GitService | null = null
let worktreeService: WorktreeService | null = null
let hookWatcher: ClaudeHookWatcher | null = null
let updateService: UpdateService | null = null
let githubService: GitHubService | null = null
let taskService: TaskService | null = null
let fileWatcherService: FileWatcherService | null = null
let automationService: AutomationService | null = null


/**
 * Verify that a Claude session file exists (async version)
 * Sessions are stored in ~/.claude/projects/{encoded-path}/
 */
async function verifyClaudeSessionAsync(cwd: string, sessionId: string): Promise<boolean> {
  try {
    // Claude encodes the path for the session directory
    // The session file is stored as {sessionId}.json
    const claudeDir = path.join(os.homedir(), '.claude', 'projects')

    // Claude encodes the path by replacing certain characters
    const encodedPath = cwd.replace(/[/\\:]/g, '-').replace(/^-/, '')
    const sessionPath = path.join(claudeDir, encodedPath, `${sessionId}.json`)

    await fs.access(sessionPath)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a path exists on disk (async version)
 */
async function pathExistsAsync(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

/**
 * Restore sessions from previous app close
 */
async function restoreSessions(): Promise<void> {
  if (!projectPersistence || !terminalManager || !win) {
    console.log('[Session] Cannot restore: services not initialized')
    return
  }

  const sessions = projectPersistence.getSessions()
  if (sessions.length === 0) {
    console.log('[Session] No sessions to restore')
    return
  }

  console.log(`[Session] Attempting to restore ${sessions.length} sessions`)

  const projects = projectPersistence.getProjects()
  const projectMap = new Map(projects.map(p => [p.id, p]))

  // Pre-validate all sessions in parallel for better performance
  const validationResults = await Promise.all(
    sessions.map(async (session) => {
      // Verify project still exists
      const project = projectMap.get(session.projectId)
      if (!project) {
        return { session, valid: false, reason: `project ${session.projectId} no longer exists` }
      }

      // Verify worktree still exists (if applicable)
      if (session.worktreeId) {
        const worktree = projectPersistence!.getWorktreeById(session.worktreeId)
        if (!worktree) {
          return { session, valid: false, reason: `worktree ${session.worktreeId} no longer exists` }
        }
        // Verify worktree path still exists on disk
        const worktreeExists = await pathExistsAsync(worktree.path)
        if (!worktreeExists) {
          return { session, valid: false, reason: `worktree path ${worktree.path} no longer exists` }
        }
      }

      // Verify CWD still exists
      const cwdExists = await pathExistsAsync(session.cwd)
      if (!cwdExists) {
        return { session, valid: false, reason: `cwd ${session.cwd} no longer exists` }
      }

      // Verify Claude session file exists (optional - Claude handles gracefully if missing)
      const sessionFileExists = await verifyClaudeSessionAsync(session.cwd, session.claudeSessionId)

      return { session, project, valid: true, sessionFileExists }
    })
  )

  // Process validated sessions
  for (const result of validationResults) {
    if (!result.valid) {
      console.log(`[Session] Skipping session: ${result.reason}`)
      continue
    }

    const { session, project, sessionFileExists } = result

    try {
      if (!sessionFileExists) {
        console.log(`[Session] Session file not found for ${session.claudeSessionId}, starting fresh`)
      }

      // Create terminal with --resume flag (or fresh if session file missing)
      const terminalId = terminalManager.createTerminal({
        cwd: session.cwd,
        type: 'claude',
        initialTitle: session.title || undefined,
        projectId: session.projectId,
        worktreeId: session.worktreeId ?? undefined,
        resumeSessionId: sessionFileExists ? session.claudeSessionId : undefined,  // only resume if session file exists
        dangerouslySkipPermissions: project?.settings?.dangerouslySkipPermissions ?? false,
      })

      console.log(`[Session] Restored terminal ${terminalId} for session ${session.claudeSessionId}`)

      // Notify renderer about restored session
      win.webContents.send('session:restored', {
        terminalId,
        projectId: session.projectId,
        worktreeId: session.worktreeId,
        title: session.title,
      })
    } catch (error) {
      console.error(`[Session] Failed to restore session:`, error)
    }
  }

  // Clear persisted sessions after restoration
  projectPersistence.clearSessions()
  console.log('[Session] Restoration complete, cleared persisted sessions')
}

const preload = path.join(__dirname, '../preload/index.cjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    title: 'Command',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'build', 'icon.ico')
      : path.join(process.env.APP_ROOT, 'build', 'icon.ico'),
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1b26',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-pty terminal functionality
    },
  })

  // Install Claude Code hooks for state detection
  installClaudeHooks()

  // Initialize hook watcher
  hookWatcher = new ClaudeHookWatcher(win)
  hookWatcher.start()

  // Initialize services
  terminalManager = new TerminalManager(win, hookWatcher)
  projectPersistence = new ProjectPersistence()
  gitService = new GitService()
  worktreeService = new WorktreeService()
  updateService = new UpdateService()
  updateService.initialize(win)
  githubService = new GitHubService()
  githubService.setWindow(win)
  taskService = new TaskService()
  fileWatcherService = new FileWatcherService(win)
  automationService = new AutomationService(worktreeService)
  automationService.setWindow(win)
  automationService.setProjectPersistence(projectPersistence)
  automationService.registerEventTriggers(hookWatcher, githubService, fileWatcherService)
  automationService.startAllSchedulers()
  automationService.checkMissedRuns()

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Pause/resume GitHub polling on focus/blur
  win.on('blur', () => {
    githubService?.pauseAllPolling()
  })
  win.on('focus', () => {
    githubService?.resumeAllPolling()
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Handle close request
  win.on('close', (e) => {
    if (terminalManager?.hasActiveTerminals()) {
      e.preventDefault()
      win?.webContents.send('app:close-request')
    }
  })
}

// IPC Handlers for Terminal operations
ipcMain.handle('terminal:create', async (_event, projectId: string, worktreeId?: string, type: 'claude' | 'normal' = 'claude') => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }
  if (worktreeId && !isValidUUID(worktreeId)) {
    throw new Error('Invalid worktree ID')
  }
  if (type !== undefined && type !== 'claude' && type !== 'normal') {
    throw new Error('Invalid terminal type')
  }

  // Look up project for settings and path
  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)

  // Determine the working directory and initial title
  let cwd: string
  let initialTitle: string | undefined

  if (worktreeId) {
    // Use worktree path if provided
    const worktree = projectPersistence?.getWorktreeById(worktreeId)
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`)
    }
    cwd = worktree.path
    // Use worktree name as terminal title
    initialTitle = worktree.name
  } else {
    cwd = project?.path ?? process.cwd()
  }

  // For worktree terminals, default to plan mode initial input
  const effectiveInitialInput = worktreeId ? '/workflows:plan ' : undefined
  return terminalManager?.createTerminal({
    cwd,
    type,
    initialInput: effectiveInitialInput,
    initialTitle,
    projectId,
    worktreeId: worktreeId ?? undefined,
    dangerouslySkipPermissions: project?.settings?.dangerouslySkipPermissions ?? false,
  })
})

ipcMain.on('terminal:write', (_event, terminalId: string, data: string) => {
  if (!isValidUUID(terminalId)) return
  if (typeof data !== 'string' || data.length > 1_000_000) return
  terminalManager?.writeToTerminal(terminalId, data)
})

ipcMain.on('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
  if (!isValidUUID(terminalId)) return
  if (typeof cols !== 'number' || !Number.isFinite(cols)) return
  if (typeof rows !== 'number' || !Number.isFinite(rows)) return
  const safeCols = clamp(cols, 1, 500)
  const safeRows = clamp(rows, 1, 200)
  terminalManager?.resizeTerminal(terminalId, safeCols, safeRows)
})

ipcMain.on('terminal:close', (_event, terminalId: string) => {
  if (!isValidUUID(terminalId)) return
  terminalManager?.closeTerminal(terminalId)
})

// IPC Handlers for Project operations
ipcMain.handle('project:list', async () => {
  return projectPersistence?.getProjects() ?? []
})

ipcMain.handle('project:add', async (_event, projectPath: string, name?: string, type?: 'workspace' | 'project' | 'code') => {
  const validTypes = ['workspace', 'project', 'code'] as const
  if (type !== undefined && !validTypes.includes(type)) {
    throw new Error('Invalid project type')
  }
  return projectPersistence?.addProject(projectPath, name, type)
})

ipcMain.handle('project:remove', async (_event, id: string) => {
  await fileWatcherService?.stopWatching(id)
  automationService?.onProjectDeleted(id)
  return projectPersistence?.removeProject(id)
})

ipcMain.handle('project:update', async (_event, id: string, updates: Record<string, unknown>) => {
  if (!isValidUUID(id)) throw new Error('Invalid project ID')
  const allowedUpdates: Record<string, unknown> = {}
  if (updates.settings && typeof updates.settings === 'object' && !Array.isArray(updates.settings)) {
    const s = updates.settings as Record<string, unknown>
    allowedUpdates.settings = {
      dangerouslySkipPermissions: s.dangerouslySkipPermissions === true,
    }
  }
  if (typeof updates.name === 'string') {
    allowedUpdates.name = updates.name
  }
  return projectPersistence?.updateProject(id, allowedUpdates)
})

ipcMain.handle('project:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('project:reorder', async (_event, projectIds: string[]) => {
  if (!Array.isArray(projectIds) || !projectIds.every(isValidUUID)) {
    throw new Error('Invalid project IDs')
  }
  projectPersistence?.reorderProjects(projectIds)
  return projectPersistence?.getProjects() ?? []
})

ipcMain.handle('project:setActiveWatcher', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }
  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)
  if (!project) return

  await fileWatcherService?.switchTo(project.id, project.path)
})

// IPC Handlers for File System operations
ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
  if (typeof dirPath !== 'string' || dirPath.length === 0 || dirPath.length > 1000) {
    throw new Error('Invalid directory path')
  }

  // Validate directory is within a registered project
  const resolved = path.resolve(path.normalize(dirPath))
  const projects = projectPersistence?.getProjects() ?? []
  const isWin = process.platform === 'win32'
  const normalizedResolved = isWin ? resolved.toLowerCase() : resolved
  const isInProject = projects.some(p => {
    const projectPath = path.resolve(p.path)
    const normalizedProject = isWin ? projectPath.toLowerCase() : projectPath
    return normalizedResolved.startsWith(normalizedProject + path.sep) || normalizedResolved === normalizedProject
  })
  if (!isInProject) {
    throw new Error('Directory is outside of any registered project')
  }

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true })

    const result = entries
      .map(entry => ({
        name: entry.name,
        path: path.join(resolved, entry.name),
        type: entry.isDirectory() ? 'directory' : 'file',
        extension: entry.isFile() ? path.extname(entry.name).slice(1).toLowerCase() : undefined,
      }))
      .sort((a, b) => {
        // Directories first, then alphabetically
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true })
      })

    return result
  } catch (error) {
    console.error('Failed to read directory:', dirPath, error)
    throw error
  }
})

// IPC Handlers for File read/write operations
function validateFilePathInProject(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1000) {
    throw new Error('Invalid file path')
  }
  const resolved = path.resolve(path.normalize(filePath))
  const projects = projectPersistence?.getProjects() ?? []

  // Case-insensitive comparison on Windows
  const isWin = process.platform === 'win32'
  const normalizedResolved = isWin ? resolved.toLowerCase() : resolved

  const isInProject = projects.some(p => {
    const projectPath = path.resolve(p.path)
    const normalizedProject = isWin ? projectPath.toLowerCase() : projectPath
    return normalizedResolved.startsWith(normalizedProject + path.sep) || normalizedResolved === normalizedProject
  })

  if (!isInProject) {
    throw new Error('File path is not within a registered project')
  }
  return resolved
}

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  console.log('[fs:readFile] Request:', filePath)
  try {
    const resolved = validateFilePathInProject(filePath)
    console.log('[fs:readFile] Validated:', resolved)
    const stat = await fs.stat(resolved)
    if (stat.size > 10 * 1024 * 1024) {
      throw new Error('File too large (max 10MB)')
    }
    return fs.readFile(resolved, 'utf-8')
  } catch (error) {
    console.error('[fs:readFile] Error:', error)
    throw error
  }
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  const resolved = validateFilePathInProject(filePath)
  if (typeof content !== 'string') {
    throw new Error('Invalid content')
  }
  if (content.length > 10 * 1024 * 1024) {
    throw new Error('Content too large (max 10MB)')
  }
  await fs.writeFile(resolved, content, 'utf-8')
})

ipcMain.handle('fs:stat', async (_event, filePath: string) => {
  const resolved = validateFilePathInProject(filePath)
  try {
    const stat = await fs.stat(resolved)
    return { exists: true, isFile: stat.isFile(), resolved }
  } catch {
    return { exists: false, isFile: false, resolved: '' }
  }
})

ipcMain.handle('fs:createFile', async (_event, filePath: string) => {
  const resolved = validateFilePathInProject(filePath)
  // wx flag: create exclusively, fails if file already exists (atomic)
  await fs.writeFile(resolved, '', { flag: 'wx' })
})

ipcMain.handle('fs:createDirectory', async (_event, dirPath: string) => {
  const resolved = validateFilePathInProject(dirPath)
  await fs.mkdir(resolved, { recursive: false })
})

ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
  const resolvedOld = validateFilePathInProject(oldPath)
  const resolvedNew = validateFilePathInProject(newPath)
  try {
    await fs.access(resolvedNew)
    throw new Error('Destination already exists')
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'Destination already exists') throw err
  }
  await fs.rename(resolvedOld, resolvedNew)
})

ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
  const resolved = validateFilePathInProject(targetPath)

  // Prevent deleting project root directories
  const projects = projectPersistence?.getProjects() ?? []
  const isWin = process.platform === 'win32'
  const normalizedResolved = isWin ? resolved.toLowerCase() : resolved
  const isProjectRoot = projects.some(p => {
    const projectPath = path.resolve(p.path)
    return (isWin ? projectPath.toLowerCase() : projectPath) === normalizedResolved
  })
  if (isProjectRoot) {
    throw new Error('Cannot delete project root directory')
  }

  const stat = await fs.stat(resolved)
  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true })
  } else {
    await fs.unlink(resolved)
  }
})

ipcMain.handle('shell:show-item-in-folder', async (_event, filePath: string) => {
  const resolved = validateFilePathInProject(filePath)
  shell.showItemInFolder(resolved)
})

// IPC Handlers for Git operations
ipcMain.handle('git:status', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.getStatus(projectPath)
})

ipcMain.handle('git:fetch', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.fetch(projectPath)
})

ipcMain.handle('git:pull', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.pull(projectPath)
})

ipcMain.handle('git:push', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.push(projectPath)
})

ipcMain.handle('git:get-remote-url', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.getRemoteUrl(projectPath) ?? null
})

ipcMain.handle('git:commit-log', async (_event, projectPath: string, skip?: number, limit?: number) => {
  validateProjectPath(projectPath)
  const safeSkip = typeof skip === 'number' && skip >= 0 ? skip : 0
  const safeLimit = typeof limit === 'number' && limit >= 1 && limit <= 500 ? limit : 100
  return gitService?.getCommitLog(projectPath, safeSkip, safeLimit) ?? { commits: [], hasMore: false }
})

ipcMain.handle('git:commit-detail', async (_event, projectPath: string, commitHash: string) => {
  validateProjectPath(projectPath)
  if (typeof commitHash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commitHash)) {
    throw new Error('Invalid commit hash')
  }
  return gitService?.getCommitDetail(projectPath, commitHash) ?? null
})

ipcMain.handle('git:file-at-commit', async (_event, projectPath: string, commitHash: string, filePath: string) => {
  validateProjectPath(projectPath)
  if (typeof commitHash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commitHash)) {
    throw new Error('Invalid commit hash')
  }
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1000) {
    throw new Error('Invalid file path')
  }
  return gitService?.getFileAtCommit(projectPath, commitHash, filePath) ?? null
})

ipcMain.handle('git:head-hash', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.getHeadHash(projectPath) ?? null
})

// IPC Handlers for Tasks operations
ipcMain.handle('tasks:scan', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return taskService?.parseAllTasks(projectPath) ?? null
})

ipcMain.handle('tasks:update', async (_event, projectPath: string, update: { filePath: string; lineNumber: number; action: 'toggle' | 'edit' | 'delete'; newText?: string }) => {
  validateProjectPath(projectPath)
  update.filePath = validateFilePathInProject(update.filePath)
  if (typeof update.lineNumber !== 'number' || update.lineNumber < 1 || update.lineNumber > 100000) {
    throw new Error('Invalid line number')
  }
  if (!['toggle', 'edit', 'delete'].includes(update.action)) {
    throw new Error('Invalid action')
  }
  if (update.action === 'edit' && (typeof update.newText !== 'string' || update.newText.length === 0 || update.newText.length > 10000)) {
    throw new Error('Invalid newText')
  }
  return taskService?.updateTask(projectPath, update) ?? null
})

ipcMain.handle('tasks:add', async (_event, projectPath: string, task: { filePath: string; section: string; text: string }) => {
  validateProjectPath(projectPath)
  task.filePath = validateFilePathInProject(task.filePath)
  if (typeof task.section !== 'string' || task.section.length === 0 || task.section.length > 200) {
    throw new Error('Invalid section name')
  }
  if (typeof task.text !== 'string' || task.text.length === 0 || task.text.length > 10000) {
    throw new Error('Invalid task text')
  }
  return taskService?.addTask(projectPath, task) ?? null
})

ipcMain.handle('tasks:delete', async (_event, projectPath: string, filePath: string, lineNumber: number) => {
  validateProjectPath(projectPath)
  filePath = validateFilePathInProject(filePath)
  if (typeof lineNumber !== 'number' || lineNumber < 1 || lineNumber > 100000) {
    throw new Error('Invalid line number')
  }
  return taskService?.deleteTask(projectPath, filePath, lineNumber) ?? null
})

ipcMain.handle('tasks:move', async (_event, projectPath: string, move: { filePath: string; lineNumber: number; targetSection: string }) => {
  validateProjectPath(projectPath)
  move.filePath = validateFilePathInProject(move.filePath)
  if (typeof move.lineNumber !== 'number' || move.lineNumber < 1 || move.lineNumber > 100000) {
    throw new Error('Invalid line number')
  }
  if (typeof move.targetSection !== 'string' || move.targetSection.length === 0 || move.targetSection.length > 200) {
    throw new Error('Invalid target section')
  }
  return taskService?.moveTask(projectPath, move) ?? null
})

ipcMain.handle('tasks:create-file', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return taskService?.createTemplateFile(projectPath) ?? null
})

// IPC Handlers for GitHub operations
ipcMain.handle('github:check-available', async () => {
  const installed = await githubService!.isGhInstalled()
  const authenticated = installed ? await githubService!.isGhAuthenticated() : false
  return { installed, authenticated }
})

ipcMain.handle('github:get-pr-status', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return githubService!.getPRStatus(projectPath)
})

ipcMain.handle('github:merge-pr', async (_event, projectPath: string, prNumber: number) => {
  validateProjectPath(projectPath)
  if (typeof prNumber !== 'number' || prNumber < 1) {
    throw new Error('Invalid PR number')
  }
  return githubService!.mergePR(projectPath, prNumber)
})

ipcMain.handle('github:start-polling', async (_event, key: string, projectPath: string) => {
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new Error('Invalid polling key')
  }
  validateProjectPath(projectPath)
  githubService!.startPolling(key, projectPath)
})

ipcMain.handle('github:stop-polling', async (_event, key: string) => {
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
    throw new Error('Invalid polling key')
  }
  githubService!.stopPolling(key)
})

// IPC Handlers for Worktree operations
ipcMain.handle('worktree:create', async (_event, projectId: string, branchName: string, worktreeName?: string) => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }
  if (typeof branchName !== 'string' || branchName.length === 0 || branchName.length > 200) {
    throw new Error('Invalid branch name')
  }

  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }

  // Create the worktree using git
  const result = await worktreeService!.createWorktree(project.path, branchName, worktreeName)

  // Save worktree to persistence
  const name = worktreeName || branchName.replace(/\//g, '-')
  const worktree = projectPersistence!.addWorktree({
    id: randomUUID(),
    projectId,
    name,
    branch: result.branch,
    path: result.path,
    createdAt: Date.now(),
    isLocked: false,
  })

  return worktree
})

ipcMain.handle('worktree:list', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }

  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)

  if (!project || !projectPersistence || !worktreeService) {
    return projectPersistence?.getWorktrees(projectId) ?? []
  }

  try {
    // Get actual git worktrees from disk
    const gitWorktrees = await worktreeService.listWorktrees(project.path)

    // Get persisted worktrees
    const persistedWorktrees = projectPersistence.getWorktrees(projectId)

    // Build lookup maps for comparison (normalize paths for Windows compatibility)
    const gitPathSet = new Set(
      gitWorktrees
        .filter(wt => !wt.isMain) // Skip main worktree (project root)
        .map(wt => path.normalize(wt.path).toLowerCase())
    )

    const persistedPathMap = new Map(
      persistedWorktrees.map(wt => [path.normalize(wt.path).toLowerCase(), wt])
    )

    // Add worktrees that exist in git but not in persistence
    for (const gitWorktree of gitWorktrees) {
      if (gitWorktree.isMain) continue // Skip main worktree

      const normalizedPath = path.normalize(gitWorktree.path).toLowerCase()
      if (!persistedPathMap.has(normalizedPath)) {
        // Derive name from directory basename, fallback to branch name
        const dirName = path.basename(gitWorktree.path)
        const name = dirName && dirName.length > 1 && !/^[A-Z]:$/i.test(dirName)
          ? dirName
          : gitWorktree.branch.replace(/\//g, '-')

        projectPersistence.addWorktree({
          id: randomUUID(),
          projectId,
          name,
          branch: gitWorktree.branch,
          path: gitWorktree.path,
          createdAt: Date.now(),
          isLocked: gitWorktree.isLocked,
        })
      }
    }

    // Remove worktrees from persistence that no longer exist in git
    for (const persisted of persistedWorktrees) {
      const normalizedPath = path.normalize(persisted.path).toLowerCase()
      if (!gitPathSet.has(normalizedPath)) {
        projectPersistence.removeWorktree(persisted.id)
      }
    }

    // Update lock state for existing worktrees
    for (const gitWorktree of gitWorktrees) {
      if (gitWorktree.isMain) continue

      const normalizedPath = path.normalize(gitWorktree.path).toLowerCase()
      const persisted = persistedPathMap.get(normalizedPath)
      if (persisted && persisted.isLocked !== gitWorktree.isLocked) {
        projectPersistence.updateWorktree(persisted.id, { isLocked: gitWorktree.isLocked })
      }
    }

    return projectPersistence.getWorktrees(projectId)
  } catch (error) {
    console.error('Failed to sync worktrees:', error)
    // Fallback to persisted worktrees if sync fails
    return projectPersistence.getWorktrees(projectId)
  }
})

ipcMain.handle('worktree:list-branches', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }

  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)
  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }

  const [local, remote, current] = await Promise.all([
    worktreeService!.listBranches(project.path),
    worktreeService!.listRemoteBranches(project.path),
    worktreeService!.getCurrentBranch(project.path),
  ])

  return { local, remote, current }
})

ipcMain.handle('worktree:remove', async (_event, worktreeId: string, force: boolean = false) => {
  if (!isValidUUID(worktreeId)) {
    throw new Error('Invalid worktree ID')
  }

  const worktree = projectPersistence?.getWorktreeById(worktreeId)
  if (!worktree) {
    throw new Error(`Worktree not found: ${worktreeId}`)
  }

  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === worktree.projectId)
  if (!project) {
    throw new Error(`Project not found: ${worktree.projectId}`)
  }

  // Remove the worktree using git
  await worktreeService!.removeWorktree(project.path, worktree.path, force)

  // Delete the local branch now that the worktree is gone
  if (worktree.branch) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('git', ['branch', '-D', worktree.branch], { cwd: project.path, timeout: 10_000 }, (err) => {
          if (err) reject(err); else resolve()
        })
      })
    } catch {
      // Branch may already be deleted or is the current branch — fine
    }
  }

  // Remove from persistence
  projectPersistence!.removeWorktree(worktreeId)
})

ipcMain.handle('worktree:has-changes', async (_event, worktreeId: string) => {
  if (!isValidUUID(worktreeId)) {
    throw new Error('Invalid worktree ID')
  }

  const worktree = projectPersistence?.getWorktreeById(worktreeId)
  if (!worktree) {
    throw new Error(`Worktree not found: ${worktreeId}`)
  }

  return worktreeService!.hasUncommittedChanges(worktree.path)
})

// IPC Handlers for Notifications
ipcMain.on('notification:show', (_event, title: string, body: string) => {
  new Notification({ title, body }).show()
})

// IPC Handlers for Shell operations
function validateShellPath(targetPath: unknown): string {
  if (typeof targetPath !== 'string' || targetPath.length === 0 || targetPath.length > 1000) {
    throw new Error('Invalid path')
  }
  const projects = projectPersistence?.getProjects() ?? []
  const isKnownProject = projects.some(p => p.path === targetPath)
  if (!isKnownProject) {
    throw new Error('Path is not a registered project')
  }
  return targetPath
}

ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
  return shell.openPath(validateShellPath(targetPath))
})

ipcMain.handle('shell:open-in-editor', async (_event, targetPath: string) => {
  const validPath = validateShellPath(targetPath)
  return new Promise<void>((resolve, reject) => {
    execFile('antigravity', [validPath], { timeout: 10000 }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
})

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (typeof url !== 'string' || !url.match(/^https?:\/\//)) {
    throw new Error('Only HTTP/HTTPS URLs allowed')
  }
  return shell.openExternal(url)
})

// IPC Handlers for App lifecycle
ipcMain.on('app:confirm-close', () => {
  terminalManager?.closeAllTerminals()
  app.exit(0)
})

ipcMain.on('app:cancel-close', () => {
  // User cancelled, do nothing
})

// IPC Handlers for Update operations
ipcMain.handle('update:check', async () => {
  return updateService?.checkForUpdates()
})

ipcMain.handle('update:download', async () => {
  return updateService?.downloadUpdate()
})

ipcMain.handle('update:install', () => {
  updateService?.quitAndInstall()
})

ipcMain.handle('update:get-version', () => {
  return updateService?.getCurrentVersion() ?? app.getVersion()
})

// ─── Automation IPC handlers ───

ipcMain.handle('automation:list', async () => {
  return automationService?.getAutomations() ?? []
})

ipcMain.handle('automation:create', async (_event, data: Record<string, unknown>) => {
  if (!automationService) throw new Error('AutomationService not initialized')
  const name = typeof data.name === 'string' ? data.name.slice(0, 100) : ''
  const prompt = typeof data.prompt === 'string' ? data.prompt.slice(0, 50000) : ''
  if (!name || !prompt) throw new Error('Name and prompt are required')

  const projectIds = Array.isArray(data.projectIds) ? data.projectIds.filter((id: unknown) => typeof id === 'string' && isValidUUID(id as string)) : []
  if (projectIds.length === 0) throw new Error('At least one project is required')

  return automationService.createAutomation({
    name,
    prompt,
    projectIds: projectIds as string[],
    trigger: data.trigger as { type: 'schedule'; cron: string } | { type: 'claude-done'; projectId?: string } | { type: 'git-event'; event: 'pr-merged' | 'pr-opened' | 'checks-passed' } | { type: 'file-change'; patterns: string[]; cooldownSeconds: number },
    enabled: data.enabled !== false,
    baseBranch: typeof data.baseBranch === 'string' ? data.baseBranch : undefined,
    timeoutMinutes: typeof data.timeoutMinutes === 'number' ? clamp(data.timeoutMinutes, 1, 120) : 30,
  })
})

ipcMain.handle('automation:update', async (_event, id: string, updates: Record<string, unknown>) => {
  if (!isValidUUID(id)) throw new Error('Invalid automation ID')
  if (!automationService) throw new Error('AutomationService not initialized')
  const allowedUpdates: Record<string, unknown> = {}
  if (typeof updates.name === 'string') allowedUpdates.name = updates.name.slice(0, 100)
  if (typeof updates.prompt === 'string') allowedUpdates.prompt = updates.prompt.slice(0, 50000)
  if (Array.isArray(updates.projectIds)) allowedUpdates.projectIds = updates.projectIds.filter((id: unknown) => typeof id === 'string')
  if (updates.trigger) allowedUpdates.trigger = updates.trigger
  if (typeof updates.enabled === 'boolean') allowedUpdates.enabled = updates.enabled
  if (typeof updates.baseBranch === 'string') allowedUpdates.baseBranch = updates.baseBranch
  if (typeof updates.timeoutMinutes === 'number') allowedUpdates.timeoutMinutes = clamp(updates.timeoutMinutes as number, 1, 120)
  return automationService.updateAutomation(id, allowedUpdates)
})

ipcMain.handle('automation:delete', async (_event, id: string) => {
  if (!isValidUUID(id)) throw new Error('Invalid automation ID')
  automationService?.deleteAutomation(id)
})

ipcMain.handle('automation:toggle', async (_event, id: string) => {
  if (!isValidUUID(id)) throw new Error('Invalid automation ID')
  return automationService?.toggleAutomation(id)
})

ipcMain.handle('automation:trigger', async (_event, id: string) => {
  if (!isValidUUID(id)) throw new Error('Invalid automation ID')
  if (!automationService || !projectPersistence) throw new Error('Services not initialized')

  const automation = automationService.getAutomation(id)
  if (!automation) throw new Error('Automation not found')

  // Trigger for each assigned project
  const projects = projectPersistence.getProjects()
  for (const projectId of automation.projectIds) {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      // Fire and forget - don't await, let it run in background
      automationService.triggerRun(id, project.path, projectId).catch(err => {
        console.error(`[Automation] Run failed for ${id}:`, err)
      })
    }
  }
})

ipcMain.handle('automation:stop-run', async (_event, runId: string) => {
  if (!isValidUUID(runId)) throw new Error('Invalid run ID')
  automationService?.stopRun(runId)
})

ipcMain.handle('automation:list-runs', async (_event, automationId?: string, limit?: number) => {
  if (automationId && !isValidUUID(automationId)) throw new Error('Invalid automation ID')
  return automationService?.getRuns(automationId, limit) ?? []
})

ipcMain.handle('automation:mark-read', async (_event, runId: string) => {
  if (!isValidUUID(runId)) throw new Error('Invalid run ID')
  automationService?.markRunRead(runId)
})

ipcMain.handle('automation:delete-run', async (_event, runId: string) => {
  if (!isValidUUID(runId)) throw new Error('Invalid run ID')
  automationService?.deleteRun(runId)
})

ipcMain.handle('automation:get-next-run', async (_event, automationId: string) => {
  if (!isValidUUID(automationId)) throw new Error('Invalid automation ID')
  return automationService?.getNextRunTime(automationId) ?? null
})

app.whenReady().then(async () => {
  await createWindow()

  // Restore sessions from previous app close (with delay for store initialization)
  setTimeout(() => {
    restoreSessions().catch((err) => {
      console.error('Session restoration failed:', err)
    })
  }, 1000) // 1 second delay for store init

  // Check for updates after app is loaded (with delay to not block UI)
  setTimeout(() => {
    if (app.isPackaged) {
      updateService?.checkForUpdates().catch((err) => {
        console.error('Auto update check failed:', err)
      })
    }
  }, 5000) // 5 second delay

  // Check for missed automation runs on wake from sleep
  powerMonitor.on('resume', () => {
    console.log('[PowerMonitor] System resumed from sleep, checking missed automation runs')
    automationService?.checkMissedRuns()
  })
})

app.on('before-quit', () => {
  // Persist Claude sessions for restoration on next startup
  if (hookWatcher && terminalManager && projectPersistence) {
    const terminalSessions = hookWatcher.getTerminalSessions()
    const sessionsToSave: PersistedSession[] = []

    for (const { terminalId, sessionId } of terminalSessions) {
      const info = terminalManager.getTerminalInfo(terminalId)
      if (info && info.type === 'claude') {
        sessionsToSave.push({
          terminalId,
          projectId: info.projectId,
          worktreeId: info.worktreeId ?? null,
          claudeSessionId: sessionId,
          cwd: info.cwd,
          title: info.title ?? '',
          closedAt: Date.now(),
        })
      }
    }

    if (sessionsToSave.length > 0) {
      console.log(`[Session] Persisting ${sessionsToSave.length} sessions for restoration`)
      projectPersistence.setSessions(sessionsToSave)
    }
  }

  // Stop automations (kills running processes, marks runs as failed)
  automationService?.destroy().catch(err => {
    console.error('[AutomationService] Cleanup error:', err)
  })

  // Stop file watchers before terminal cleanup to avoid EBUSY
  fileWatcherService?.stopAll().catch(err => {
    console.error('[FileWatcher] Cleanup error:', err)
  })
  hookWatcher?.stop()
  githubService?.destroy()
  terminalManager?.destroy()
})

app.on('window-all-closed', () => {
  hookWatcher?.stop()
  terminalManager?.closeAllTerminals()
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})
