import { app, BrowserWindow, shell, ipcMain, dialog, Notification, Menu } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { TerminalManager } from './services/TerminalManager'
import { ProjectPersistence } from './services/ProjectPersistence'
import { GitService } from './services/GitService'
import { WorktreeService } from './services/WorktreeService'
import { ClaudeHookWatcher } from './services/ClaudeHookWatcher'
import { installClaudeHooks } from './services/HookInstaller'
import { UpdateService } from './services/UpdateService'
import { GitHubService } from './services/GitHubService'
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
if (process.platform === 'win32') app.setAppUserModelId('Claude Code Command Center')

// Use separate userData folder for dev mode to allow running alongside production
if (VITE_DEV_SERVER_URL) {
  const devUserData = path.join(app.getPath('userData'), '-dev')
  app.setPath('userData', devUserData)
}

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

const preload = path.join(__dirname, '../preload/index.cjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    title: 'Command',
    icon: path.join(process.env.APP_ROOT, 'build', 'icon.ico'),
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

  // Determine the working directory
  let cwd: string

  if (worktreeId) {
    // Use worktree path if provided
    const worktree = projectPersistence?.getWorktreeById(worktreeId)
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`)
    }
    cwd = worktree.path
  } else {
    // Use project path
    const projects = projectPersistence?.getProjects() ?? []
    const project = projects.find(p => p.id === projectId)
    cwd = project?.path ?? process.cwd()
  }

  // For worktree terminals, default to plan mode initial input
  const effectiveInitialInput = worktreeId ? '/workflows:plan ' : undefined
  return terminalManager?.createTerminal(cwd, type, effectiveInitialInput)
})

ipcMain.on('terminal:write', (_event, terminalId: string, data: string) => {
  if (!isValidUUID(terminalId)) return
  if (typeof data !== 'string' || data.length > 1_000_000) return
  terminalManager?.writeToTerminal(terminalId, data)
})

ipcMain.on('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
  if (!isValidUUID(terminalId)) return
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

ipcMain.handle('project:add', async (_event, projectPath: string, name?: string) => {
  return projectPersistence?.addProject(projectPath, name)
})

ipcMain.handle('project:remove', async (_event, id: string) => {
  return projectPersistence?.removeProject(id)
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

// IPC Handlers for File System operations
ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
  if (typeof dirPath !== 'string' || dirPath.length === 0 || dirPath.length > 1000) {
    throw new Error('Invalid directory path')
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    const result = entries
      .filter(entry => !entry.name.startsWith('.')) // Hide hidden files
      .map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
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
  const isInProject = projects.some(p => resolved.startsWith(path.resolve(p.path)))
  if (!isInProject) {
    throw new Error('File path is not within a registered project')
  }
  return resolved
}

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const resolved = validateFilePathInProject(filePath)
  const stat = await fs.stat(resolved)
  if (stat.size > 10 * 1024 * 1024) {
    throw new Error('File too large (max 10MB)')
  }
  return fs.readFile(resolved, 'utf-8')
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
  return projectPersistence?.getWorktrees(projectId) ?? []
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

app.whenReady().then(async () => {
  await createWindow()

  // Check for updates after app is loaded (with delay to not block UI)
  setTimeout(() => {
    if (app.isPackaged) {
      updateService?.checkForUpdates().catch((err) => {
        console.error('Auto update check failed:', err)
      })
    }
  }, 5000) // 5 second delay
})

app.on('before-quit', () => {
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
