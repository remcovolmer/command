import { app, BrowserWindow, shell, ipcMain, dialog, Notification } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { TerminalManager } from './services/TerminalManager'
import { ProjectPersistence } from './services/ProjectPersistence'

// Validation helpers
const isValidUUID = (id: string): boolean =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(val)))

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

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let terminalManager: TerminalManager | null = null
let projectPersistence: ProjectPersistence | null = null

const preload = path.join(__dirname, '../preload/index.cjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    title: 'Claude Code Command Center',
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

  // Initialize services
  terminalManager = new TerminalManager(win)
  projectPersistence = new ProjectPersistence()

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

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
ipcMain.handle('terminal:create', async (_event, projectId: string) => {
  // Get the project path from the project ID
  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)
  const cwd = project?.path ?? process.cwd()
  return terminalManager?.createTerminal(cwd)
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

// IPC Handlers for Notifications
ipcMain.on('notification:show', (_event, title: string, body: string) => {
  new Notification({ title, body }).show()
})

// IPC Handlers for App lifecycle
ipcMain.on('app:confirm-close', () => {
  terminalManager?.closeAllTerminals()
  app.exit(0)
})

ipcMain.on('app:cancel-close', () => {
  // User cancelled, do nothing
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
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
