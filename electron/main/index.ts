import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Notification,
  Menu,
  powerMonitor,
  clipboard,
  nativeImage,
  session,
  Tray,
} from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { TerminalManager } from './services/TerminalManager'
import { CrashLogger, writeCrashFallback, type LogEntry } from './services/CrashLogger'
import { initLogger, createLogger, getLogFilePath } from './services/Logger'
import { handleTerminalCreate } from './handlers/terminalCreate'
import { restoreSessions as restoreSessionsImpl } from './handlers/restoreSessions'
import { ProjectPersistence, type PersistedSession } from './services/ProjectPersistence'
import type {
  AgentType,
  TerminalType,
  TerminalState,
  NotchPayload,
  NotchSession,
} from '../../shared/ipc-types'
import { isAgentType } from '../../shared/agents'
import { isHookCapableAgent } from './services/agents'
import { GitService } from './services/GitService'
import { WorktreeService } from './services/WorktreeService'
import { ClaudeHookWatcher } from './services/ClaudeHookWatcher'
import { installAgentHooks } from './services/HookInstaller'
import { UpdateService } from './services/UpdateService'
import { GitHubService, type GitEvent, VALID_GIT_EVENTS } from './services/GitHubService'
import { UsageService } from './services/UsageService'
import { CodexUsageService } from './services/CodexUsageService'
import { TaskService } from './services/TaskService'
import { FileWatcherService } from './services/FileWatcherService'
import { AutomationService } from './services/AutomationService'
import { SessionIndexService } from './services/SessionIndexService'
import { normalizePath } from './utils/paths'
import { hardenWebviewPreferences, BROWSER_PARTITION } from './utils/webviewSecurity'
import { matchBrowserShortcut } from './utils/browserShortcut'
import { formatOversizeMessage, validateTerminalWritePayload } from './utils/terminalWriteLimits'
import { sanitizeClipboardText, sanitizeClipboardImage } from './utils/clipboardLimits'
import type { AutomationTrigger } from './services/AutomationPersistence'
import { SecureEnvStore } from './services/SecureEnvStore'
import { CommandServer } from './services/CommandServer'
import { SkillInstaller } from './services/SkillInstaller'
import { NotchService } from './services/NotchService'
import { randomUUID } from 'node:crypto'

// Prevent EPIPE errors on console.log from crashing the app
// (happens when parent terminal closes its stdout pipe)
process.stdout?.on('error', () => {})
process.stderr?.on('error', () => {})

// Structured logging: rotating file in userData (+ console transport in dev).
// Initialized before anything else so early-boot logs are captured.
initLogger()
const mainLog = createLogger('Main')
const appLog = createLogger('App')
const fsLog = createLogger('fs')
const sessionLog = createLogger('Session')
const sessionIndexLog = createLogger('SessionIndex')
const skillLog = createLogger('SkillInstaller')
const automationLog = createLogger('Automation')
const automationServiceLog = createLogger('AutomationService')
const fileWatcherLog = createLogger('FileWatcher')
const commandServerLog = createLogger('CommandServer')
const terminalLog = createLogger('Terminal')
const powerLog = createLogger('PowerMonitor')

// Global safety net: prevents the Electron "JavaScript error in main process"
// crash dialog. The most common trigger is node-pty's WindowsPtyAgent emitting
// "Cannot create process, error code: 267" from a worker thread when a cwd
// disappears between project registration and pty.spawn. Registered before
// app.whenReady so early-boot errors are also captured.
const crashLogger = new CrashLogger()

function notifyUncaughtError(entry: LogEntry | null): void {
  if (!entry || !win || win.isDestroyed()) return
  try {
    win.webContents.send('app:uncaught-error', entry)
  } catch {
    // window may be in the process of tearing down; nothing we can do
  }
}

// Re-entrancy guard. If logging or IPC-notifying itself throws, Node would
// re-enter the handler with the new error and recurse until stack overflow,
// defeating the very protection these handlers add.
let handlingCrash = false
function safeHandleCrash(err: unknown, source: 'uncaughtException' | 'unhandledRejection'): void {
  if (handlingCrash) {
    // Last-resort visibility; cannot use the logger or IPC without risking recursion.
    writeCrashFallback(`[${source}] (re-entrant, suppressed)`, err)
    return
  }
  handlingCrash = true
  try {
    const entry = crashLogger.log(err, source)
    mainLog.error(`[${source}]`, err)
    notifyUncaughtError(entry)
  } catch (innerErr) {
    // The structured logger may be the thing that failed; raw stderr only.
    writeCrashFallback(`[${source}] handler failed:`, innerErr)
  } finally {
    handlingCrash = false
  }
}

process.on('uncaughtException', (err) => safeHandleCrash(err, 'uncaughtException'))
process.on('unhandledRejection', (reason) => safeHandleCrash(reason, 'unhandledRejection'))

// Validation helpers
const isValidUUID = (id: string): boolean =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(val)))

const BLOCKED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'COMSPEC',
  'SYSTEMROOT',
  'WINDIR',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
])

function resolveEnvOverrides(
  project: { settings?: { authMode?: string; profileId?: string } } | undefined
): Record<string, string> | undefined {
  if (project?.settings?.authMode === 'profile' && project.settings.profileId && secureEnvStore) {
    return secureEnvStore.getEnvVars(project.settings.profileId)
  }
  return undefined
}

function validateProjectPath(projectPath: string): void {
  if (typeof projectPath !== 'string' || projectPath.length === 0 || projectPath.length > 1000) {
    throw new Error('Invalid project path')
  }
}

function validateRelativeFilePaths(files: unknown): asserts files is string[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > 500) {
    throw new Error('Invalid files array')
  }
  for (const f of files) {
    if (typeof f !== 'string' || f.length === 0 || f.length > 1000) {
      throw new Error('Invalid file path')
    }
    if (f.includes('..') || path.isAbsolute(f)) {
      throw new Error('File path must be relative and within project')
    }
  }
}

function validateBranchName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) {
    throw new Error('Invalid branch name')
  }
  if (name.startsWith('-')) {
    throw new Error('Branch name cannot start with -')
  }
}

function validateTrigger(raw: unknown): AutomationTrigger {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid trigger')
  const obj = raw as Record<string, unknown>
  switch (obj.type) {
    case 'schedule':
      if (typeof obj.cron !== 'string' || obj.cron.length === 0 || obj.cron.length > 100)
        throw new Error('Invalid cron expression')
      return { type: 'schedule', cron: obj.cron }
    case 'claude-done':
      return { type: 'claude-done' }
    case 'git-event':
      if (!VALID_GIT_EVENTS.includes(obj.event as GitEvent))
        throw new Error('Invalid git event type')
      return { type: 'git-event', event: obj.event as GitEvent }
    case 'file-change': {
      if (!Array.isArray(obj.patterns)) throw new Error('Invalid file patterns')
      const patterns = obj.patterns
        .filter((p: unknown): p is string => typeof p === 'string')
        .map((p) => p.slice(0, 500))
      if (patterns.length === 0) throw new Error('At least one file pattern required')
      if (patterns.length > 50) throw new Error('Too many file patterns (max 50)')
      const cooldown =
        typeof obj.cooldownSeconds === 'number'
          ? clamp(obj.cooldownSeconds as number, 10, 3600)
          : 60
      return { type: 'file-change', patterns, cooldownSeconds: cooldown }
    }
    default:
      throw new Error('Unknown trigger type')
  }
}

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
let notchService: NotchService | null = null
let tray: Tray | null = null
// Set once an explicit quit is requested (tray → Afsluiten, or before-quit).
// Until then, closing the main window hides it to the tray instead of quitting.
let isQuitting = false
let terminalManager: TerminalManager | null = null
let projectPersistence: ProjectPersistence | null = null
let gitService: GitService | null = null
let worktreeService: WorktreeService | null = null
let hookWatcher: ClaudeHookWatcher | null = null
let updateService: UpdateService | null = null
let githubService: GitHubService | null = null
let usageService: UsageService | null = null
let codexUsageService: CodexUsageService | null = null
let taskService: TaskService | null = null
let fileWatcherService: FileWatcherService | null = null
let automationService: AutomationService | null = null
let sessionIndexService: SessionIndexService | null = null
let unsubSessionIndex: (() => void) | null = null
let secureEnvStore: SecureEnvStore | null = null
let commandServer: CommandServer | null = null
let skillInstaller: SkillInstaller | null = null

/**
 * Verify that an agent session's transcript still exists, so restore knows
 * whether to resume it or start fresh. Per-agent because each agent stores
 * transcripts differently:
 *  - claude: ~/.claude/projects/{encoded-cwd}/{sessionId}.json
 *  - codex:  ~/.codex/sessions/**\/rollout-*-{sessionId}.jsonl (date-nested)
 *  - pi:     no reliable id-based transcript lookup → treated as not resumable
 */
async function verifyAgentSessionAsync(
  agentType: AgentType,
  cwd: string,
  sessionId: string
): Promise<boolean> {
  try {
    if (agentType === 'claude') {
      const claudeDir = path.join(os.homedir(), '.claude', 'projects')
      const encodedPath = cwd.replace(/[/\\\\:]/g, '-').replace(/^-/, '')
      const sessionPath = path.join(claudeDir, encodedPath, `${sessionId}.json`)
      await fs.access(sessionPath)
      return true
    }
    if (agentType === 'codex') {
      const codexSessions = path.join(os.homedir(), '.codex', 'sessions')
      const entries = await fs.readdir(codexSessions, { recursive: true })
      return entries.some((e) => typeof e === 'string' && e.includes(sessionId))
    }
    return false
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
 * Restore sessions from previous app close. Thin wrapper around the testable
 * implementation in ./handlers/restoreSessions.
 */
async function restoreSessions(): Promise<void> {
  return restoreSessionsImpl({
    projectPersistence,
    terminalManager,
    hookWatcher,
    getWindow: () => win,
    verifyAgentSession: verifyAgentSessionAsync,
    pathExists: pathExistsAsync,
    resolveEnvOverrides,
  })
}

const preload = path.join(__dirname, '../preload/index.cjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.ico')
    : path.join(process.env.APP_ROOT, 'build', 'icon.ico')
  tray = new Tray(iconPath)
  tray.setToolTip('Command')

  const showWindow = () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Command tonen', click: showWindow },
      { type: 'separator' },
      {
        label: 'Afsluiten',
        click: () => {
          // Confirm before killing running agents (reuses the close dialog);
          // otherwise quit straight away — before-quit persists sessions.
          if (terminalManager?.hasActiveTerminals()) {
            showWindow()
            win?.webContents.send('app:close-request')
          } else {
            isQuitting = true
            app.quit()
          }
        },
      },
    ]),
  )
  tray.on('double-click', showWindow)
}

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
      webviewTag: true, // Enables the built-in browser (<webview>); guests are hardened below
    },
  })

  // Notch strip: a second frameless always-on-top window reusing this window's
  // preload + renderer bundle via the `#strip` hash route. Foreground-driven
  // visibility and the session feed are wired in later units.
  notchService?.destroy()
  notchService = new NotchService(win, {
    preload,
    indexHtml,
    devServerUrl: VITE_DEV_SERVER_URL,
  })

  // Tray keeps Command resident so the notch survives closing the window.
  if (!tray) createTray()

  // Install hooks for every hook-capable agent (Claude, Codex) for state detection
  installAgentHooks()

  // Initialize hook watcher
  hookWatcher = new ClaudeHookWatcher(win)
  hookWatcher.start()

  // Initialize session index service
  sessionIndexService = new SessionIndexService(win)

  // Wire session index to state changes — refresh summaries on every state change
  unsubSessionIndex = hookWatcher.addStateChangeListener((terminalId, _state) => {
    if (!sessionIndexService || !hookWatcher || !terminalManager) return

    const info = terminalManager.getTerminalInfo(terminalId)
    if (!info || info.type !== 'claude') return

    const normalizedCwd = normalizePath(info.cwd)
    const terminalSessions = hookWatcher.getTerminalSessions().filter((ts) => {
      const tsInfo = terminalManager!.getTerminalInfo(ts.terminalId)
      return tsInfo && normalizePath(tsInfo.cwd) === normalizedCwd
    })

    sessionIndexService.refreshAndPush(info.cwd, terminalSessions).catch((err) => {
      sessionIndexLog.error('Refresh failed:', err)
    })
  })

  // Initialize services
  // Start CommandServer early so port/token are available for env injection into terminals
  commandServer = new CommandServer()
  await commandServer.start()

  projectPersistence = new ProjectPersistence()
  await projectPersistence.initialize()
  secureEnvStore = new SecureEnvStore()
  gitService = new GitService()
  worktreeService = new WorktreeService()
  githubService = new GitHubService()
  githubService.setWindow(win)
  usageService = new UsageService()
  usageService.setWindow(win)
  codexUsageService = new CodexUsageService()
  codexUsageService.setWindow(win)
  // Resolve CLI directory: packaged apps use resourcesPath, dev uses compiled output
  const cliDir = app.isPackaged
    ? path.join(process.resourcesPath, 'cli')
    : path.join(__dirname, '..', 'cli')

  terminalManager = new TerminalManager(win, hookWatcher, {
    commandServer: commandServer!,
    cliDir,
  })

  // Wire CommandServer deps now that all services are initialized
  commandServer.setDeps({
    terminalManager,
    projectPersistence,
    worktreeService,
    githubService,
    mainWindow: win,
  })

  // Install ccli as a global skill and clean up legacy per-project command files
  skillInstaller = new SkillInstaller()
  skillInstaller.install().catch((err) => skillLog.error('Global install failed:', err))
  const allProjectsForSkills = projectPersistence.getProjects()
  for (const project of allProjectsForSkills) {
    skillInstaller
      .cleanupLegacyCommand(project.path)
      .catch((err) => skillLog.error(`Legacy cleanup failed for ${project.path}:`, err))
  }

  updateService = new UpdateService()
  updateService.initialize(win)
  taskService = new TaskService()
  fileWatcherService = new FileWatcherService(win)
  automationService = new AutomationService(worktreeService)
  automationService.setWindow(win)
  automationService.setProjectPersistence(projectPersistence)
  automationService.registerEventTriggers(hookWatcher, githubService, fileWatcherService)
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Defer expensive automation startup until after first paint
  win.webContents.once('did-finish-load', () => {
    automationService?.startAllSchedulers()
    automationService?.checkMissedRuns()
    const allProjects = projectPersistence?.getProjects() ?? []
    automationService
      ?.garbageCollectWorktrees(allProjects.map((p) => p.path))
      .catch((err) => automationLog.error('Worktree GC failed:', err))
  })

  // Pause/resume GitHub and usage polling on focus/blur, and drive the notch
  // strip's foreground-gated visibility from the same signal.
  win.on('blur', () => {
    githubService?.pauseAllPolling()
    usageService?.pause()
    codexUsageService?.pause()
    notchService?.setMainForeground(false)
  })
  win.on('focus', () => {
    githubService?.resumeAllPolling()
    usageService?.resume()
    codexUsageService?.resume()
    notchService?.setMainForeground(true)
  })
  // hide() (close-to-tray) does not reliably emit blur on Windows, so drive the
  // notch's foreground state from hide/show too — otherwise the strip would
  // stay suppressed exactly when Command is minimized to the tray.
  win.on('hide', () => notchService?.setMainForeground(false))
  win.on('show', () => notchService?.setMainForeground(win?.isFocused() ?? false))

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !parsed.username &&
        !parsed.password
      ) {
        shell.openExternal(url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })

  // Close-to-tray: the X hides the window and keeps Command running so the
  // notch stays alive. Only an explicit quit (tray → Afsluiten, or any
  // app.quit() path, which sets isQuitting in before-quit) closes the window.
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win?.hide()
      notchService?.setMainForeground(false)
    }
  })
}

// Notch strip: receive the cross-project session snapshot from the main
// renderer and relay it to the strip. Validate each element (same rigor as the
// terminal:* handlers) rather than trusting the payload shape — the strip
// consumes id/state/agentType directly.
const VALID_NOTCH_STATES = new Set<TerminalState>([
  'busy',
  'permission',
  'question',
  'done',
  'stopped',
])

function isValidNotchSession(value: unknown): value is NotchSession {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (
    typeof s.id === 'string' &&
    isValidUUID(s.id) &&
    typeof s.projectId === 'string' &&
    typeof s.projectName === 'string' &&
    typeof s.title === 'string' &&
    isAgentType(s.agentType) &&
    typeof s.state === 'string' &&
    VALID_NOTCH_STATES.has(s.state as TerminalState)
  )
}

function sanitizeNotchPayload(payload: unknown): NotchPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as { sessions?: unknown }).sessions
  if (!Array.isArray(raw)) return null
  const sessions: NotchSession[] = raw.filter(isValidNotchSession).map((s) => ({
    id: s.id,
    projectId: s.projectId,
    projectName: s.projectName,
    title: s.title,
    agentType: s.agentType,
    state: s.state,
  }))
  return { sessions }
}

ipcMain.on('notch:update', (_event, payload: unknown) => {
  const clean = sanitizeNotchPayload(payload)
  if (clean) notchService?.setSessions(clean)
})

// Notch strip click: raise the main window and activate the clicked session.
ipcMain.on('notch:focus', (_event, terminalId: unknown) => {
  if (typeof terminalId === 'string' && isValidUUID(terminalId)) {
    notchService?.focusSession(terminalId)
  }
})

// Notch enable/disable. Echo a strip-originated change (e.g. the hide button)
// back to the main renderer so its store + sidebar toggle stay in sync.
ipcMain.on('notch:set-enabled', (event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') return
  notchService?.setEnabled(enabled)
  if (win && event.sender !== win.webContents) {
    win.webContents.send('notch:enabled', enabled)
  }
})

// Notch strip reports its rendered content size so the window fits it exactly
// (the expanded session list would otherwise clip against a fixed height).
ipcMain.on('notch:resize', (_event, width: unknown, height: unknown) => {
  if (typeof width === 'number' && typeof height === 'number') {
    notchService?.setContentSize(width, height)
  }
})

// IPC Handlers for Terminal operations
ipcMain.handle(
  'terminal:create',
  async (
    _event,
    projectId: string,
    worktreeId?: string,
    type: TerminalType = 'claude',
    resumeSessionId?: string,
    initialPrompt?: string
  ) => {
    return handleTerminalCreate(
      {
        terminalManager,
        projectPersistence,
        crashLogger,
        getWindow: () => win,
        resolveEnvOverrides,
        isValidUUID,
      },
      { projectId, worktreeId, type, resumeSessionId, initialPrompt }
    )
  }
)

ipcMain.on('terminal:write', (_event, terminalId: string, data: unknown) => {
  if (!isValidUUID(terminalId)) return
  const result = validateTerminalWritePayload(data)
  if (!result.ok) {
    if (result.reason === 'too-large') {
      const { title, body } = formatOversizeMessage(result.size, result.limit)
      terminalLog.warn(
        `terminal:write rejected ${result.size}B payload for ${terminalId}: exceeds ${result.limit}B limit`
      )
      new Notification({ title, body }).show()
    }
    return
  }
  terminalManager?.writeToTerminal(terminalId, result.data)
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

ipcMain.handle(
  'terminal:update-worktree',
  async (_event, terminalId: string, worktreeId: string, newCwd: string) => {
    if (!isValidUUID(terminalId)) throw new Error('Invalid terminal ID')
    if (!isValidUUID(worktreeId)) throw new Error('Invalid worktree ID')
    if (typeof newCwd !== 'string' || newCwd.length === 0 || newCwd.length > 1024) {
      throw new Error('Invalid cwd')
    }

    const result = terminalManager?.updateTerminalWorktree(terminalId, worktreeId, newCwd)
    if (!result || !result.success) {
      throw new Error(result?.error ?? 'Failed to update terminal worktree')
    }

    // Notify renderer of the worktree update
    if (win && !win.isDestroyed()) {
      win.webContents.send('terminal:worktree-updated', terminalId, worktreeId)

      // Also update the terminal title to the worktree name
      const worktree = projectPersistence?.getWorktreeById(worktreeId)
      if (worktree) {
        win.webContents.send('terminal:title', terminalId, worktree.name)
      }
    }

    return { success: true }
  }
)

ipcMain.on('terminal:evict', (_event, terminalId: string) => {
  if (!isValidUUID(terminalId)) return
  terminalManager?.evictTerminal(terminalId)
})

ipcMain.on('terminal:restore', (_event, terminalId: string) => {
  if (!isValidUUID(terminalId)) return
  terminalManager?.restoreTerminal(terminalId)
})

// IPC Handlers for Project operations
ipcMain.handle('project:list', async () => {
  return projectPersistence?.getProjects() ?? []
})

ipcMain.handle(
  'project:add',
  async (_event, projectPath: string, name?: string, type?: 'project' | 'code') => {
    const validTypes = ['project', 'code'] as const
    if (type !== undefined && !validTypes.includes(type)) {
      throw new Error('Invalid project type')
    }
    const result = projectPersistence?.addProject(projectPath, name, type)
    // Clean up legacy ccli command file if present in the new project
    skillInstaller
      ?.cleanupLegacyCommand(projectPath)
      .catch((err) => skillLog.error(`Legacy cleanup failed on project add:`, err))
    return result
  }
)

ipcMain.handle('project:remove', async (_event, id: string) => {
  // Close all PTY terminals for this project BEFORE cleanup
  terminalManager?.closeTerminalsForProject(id)
  // Stop GitHub polling for all worktrees under this project
  const project = projectPersistence?.getProjects().find((p) => p.id === id)
  if (project?.path) {
    githubService?.stopPollingByPathPrefix(project.path)
  }
  await fileWatcherService?.stopWatching(id)
  automationService?.onProjectDeleted(id)
  return projectPersistence?.removeProject(id)
})

ipcMain.handle('project:update', async (_event, id: string, updates: Record<string, unknown>) => {
  if (!isValidUUID(id)) throw new Error('Invalid project ID')
  const allowedUpdates: Record<string, unknown> = {}
  if (
    updates.settings &&
    typeof updates.settings === 'object' &&
    !Array.isArray(updates.settings)
  ) {
    const s = updates.settings as Record<string, unknown>
    const VALID_CLAUDE_MODES = ['chat', 'auto', 'full-auto']
    const settings: Record<string, unknown> = {
      claudeMode: VALID_CLAUDE_MODES.includes(s.claudeMode as string) ? s.claudeMode : 'chat',
      defaultAgent: isAgentType(s.defaultAgent) ? s.defaultAgent : 'claude',
    }
    // Auth mode settings
    if (s.authMode === 'subscription' || s.authMode === 'profile') {
      settings.authMode = s.authMode
    }
    if (typeof s.profileId === 'string' && isValidUUID(s.profileId)) {
      settings.profileId = s.profileId
    } else if (s.profileId === undefined || s.profileId === null) {
      settings.profileId = undefined
    }
    allowedUpdates.settings = settings
  }
  if (typeof updates.name === 'string') {
    allowedUpdates.name = updates.name
  }
  if (updates.type === 'project' || updates.type === 'code') {
    allowedUpdates.type = updates.type
  }
  return projectPersistence?.updateProject(id, allowedUpdates)
})

ipcMain.handle('project:setPinned', async (_event, id: string, pinned: boolean) => {
  if (!isValidUUID(id)) throw new Error('Invalid project ID')
  if (typeof pinned !== 'boolean') throw new Error('Invalid pinned value')
  return projectPersistence?.setProjectPinned(id, pinned)
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
  const project = projects.find((p) => p.id === projectId)
  if (!project) return

  await fileWatcherService?.switchTo(project.id, project.path)
})

ipcMain.handle('project:hasVertexConfig', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) throw new Error('Invalid project ID')
  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find((p) => p.id === projectId)
  if (!project) return false
  try {
    const filePath = path.join(project.path, '.claude', 'settings.local.json')
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as { env?: { CLAUDE_CODE_USE_VERTEX?: string } } | null
    return parsed?.env?.CLAUDE_CODE_USE_VERTEX === '1'
  } catch {
    return false
  }
})

// IPC Handlers for Profile operations
ipcMain.handle('profile:list', async () => {
  const profiles = projectPersistence?.getProfiles() ?? []
  // Derive envVarCount at read time from SecureEnvStore (not from persisted state)
  return profiles.map((p) => ({
    ...p,
    envVarCount: secureEnvStore?.getEnvVarKeys(p.id).length ?? 0,
  }))
})

ipcMain.handle('profile:add', async (_event, name: string) => {
  if (typeof name !== 'string' || name.length === 0 || name.length > 100) {
    throw new Error('Invalid profile name')
  }
  const profile = projectPersistence?.addProfile(name)
  if (!profile) throw new Error('Failed to add profile')
  return profile
})

ipcMain.handle('profile:update', async (_event, id: string, updates: { name: string }) => {
  if (!isValidUUID(id)) throw new Error('Invalid profile ID')
  if (typeof updates?.name !== 'string' || updates.name.length === 0 || updates.name.length > 100) {
    throw new Error('Invalid profile name')
  }
  return projectPersistence?.updateProfile(id, { name: updates.name }) ?? null
})

ipcMain.handle('profile:remove', async (_event, id: string) => {
  if (!isValidUUID(id)) throw new Error('Invalid profile ID')
  secureEnvStore?.deleteEnvVars(id)
  projectPersistence?.removeProfile(id)
})

ipcMain.handle('profile:setActive', async (_event, id: string | null) => {
  if (id !== null && !isValidUUID(id)) throw new Error('Invalid profile ID')
  projectPersistence?.setActiveProfileId(id)
})

ipcMain.handle('profile:getActive', async () => {
  return projectPersistence?.getActiveProfileId() ?? null
})

ipcMain.handle(
  'profile:setEnvVars',
  async (_event, profileId: string, vars: Record<string, string>) => {
    if (!isValidUUID(profileId)) throw new Error('Invalid profile ID')
    if (!vars || typeof vars !== 'object' || Array.isArray(vars))
      throw new Error('Invalid env vars')
    // Validate all keys and values are strings
    for (const [key, value] of Object.entries(vars)) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 200)
        throw new Error('Invalid env var key')
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw new Error(`Invalid env var key format: ${key}`)
      if (BLOCKED_ENV_KEYS.has(key.toUpperCase()))
        throw new Error(`Cannot override system env var: ${key}`)
      if (typeof value !== 'string' || value.length > 10000)
        throw new Error('Invalid env var value')
    }
    secureEnvStore?.setEnvVars(profileId, vars)
    // envVarCount is derived at read time in profile:list, no need to persist it
  }
)

ipcMain.handle('profile:getEnvVarKeys', async (_event, profileId: string) => {
  if (!isValidUUID(profileId)) throw new Error('Invalid profile ID')
  return secureEnvStore?.getEnvVarKeys(profileId) ?? []
})

ipcMain.handle('profile:clearEnvVars', async (_event, profileId: string) => {
  if (!isValidUUID(profileId)) throw new Error('Invalid profile ID')
  secureEnvStore?.deleteEnvVars(profileId)
  // envVarCount is derived at read time in profile:list, no need to persist it
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
  const isInProject = projects.some((p) => {
    const projectPath = path.resolve(p.path)
    const normalizedProject = isWin ? projectPath.toLowerCase() : projectPath
    return (
      normalizedResolved.startsWith(normalizedProject + path.sep) ||
      normalizedResolved === normalizedProject
    )
  })
  if (!isInProject) {
    throw new Error('Directory is outside of any registered project')
  }

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true })

    const result = entries
      .map((entry) => ({
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
    fsLog.error('Failed to read directory:', dirPath, error)
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

  const isInProject = projects.some((p) => {
    const projectPath = path.resolve(p.path)
    const normalizedProject = isWin ? projectPath.toLowerCase() : projectPath
    return (
      normalizedResolved.startsWith(normalizedProject + path.sep) ||
      normalizedResolved === normalizedProject
    )
  })

  if (!isInProject) {
    throw new Error('File path is not within a registered project')
  }
  return resolved
}

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  fsLog.debug('readFile request:', filePath)
  try {
    const resolved = validateFilePathInProject(filePath)
    fsLog.debug('readFile validated:', resolved)
    const stat = await fs.stat(resolved)
    if (stat.size > 10 * 1024 * 1024) {
      throw new Error('File too large (max 10MB)')
    }
    return fs.readFile(resolved, 'utf-8')
  } catch (error) {
    fsLog.error('readFile error:', error)
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
  // fs:stat is an existence-check IPC: it never throws. Validation failures
  // (path outside any registered project) and stat failures (file missing)
  // both collapse to { exists: false }. Callers like fileLinkProvider and the
  // OSC 8 linkHandler in useXtermInstance rely on this for silent rejection
  // of unknown paths without surfacing main-process error logs.
  let resolved: string
  try {
    resolved = validateFilePathInProject(filePath)
  } catch {
    return { exists: false, isFile: false, resolved: '' }
  }
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
  const isProjectRoot = projects.some((p) => {
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

ipcMain.handle(
  'git:commit-log',
  async (_event, projectPath: string, skip?: number, limit?: number) => {
    validateProjectPath(projectPath)
    const safeSkip = typeof skip === 'number' && skip >= 0 ? skip : 0
    const safeLimit = typeof limit === 'number' && limit >= 1 && limit <= 500 ? limit : 100
    return (
      gitService?.getCommitLog(projectPath, safeSkip, safeLimit) ?? { commits: [], hasMore: false }
    )
  }
)

ipcMain.handle('git:commit-detail', async (_event, projectPath: string, commitHash: string) => {
  validateProjectPath(projectPath)
  if (typeof commitHash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commitHash)) {
    throw new Error('Invalid commit hash')
  }
  return gitService?.getCommitDetail(projectPath, commitHash) ?? null
})

ipcMain.handle(
  'git:file-at-commit',
  async (_event, projectPath: string, commitHash: string, filePath: string) => {
    validateProjectPath(projectPath)
    if (
      typeof commitHash !== 'string' ||
      !/^([0-9a-f]{7,40}|HEAD(~\d+)?|HEAD\^?)$/i.test(commitHash)
    ) {
      throw new Error('Invalid commit hash')
    }
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1000) {
      throw new Error('Invalid file path')
    }
    if (filePath.includes('..') || path.isAbsolute(filePath)) {
      throw new Error('Invalid file path')
    }
    return gitService?.getFileAtCommit(projectPath, commitHash, filePath) ?? null
  }
)

ipcMain.handle('git:head-hash', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.getHeadHash(projectPath) ?? null
})

// IPC Handlers for Git staging, commit, discard, and branch operations

ipcMain.handle('git:stage-files', async (_event, projectPath: string, files: unknown) => {
  validateProjectPath(projectPath)
  validateRelativeFilePaths(files)
  return gitService?.stageFiles(projectPath, files)
})

ipcMain.handle('git:unstage-files', async (_event, projectPath: string, files: unknown) => {
  validateProjectPath(projectPath)
  validateRelativeFilePaths(files)
  return gitService?.unstageFiles(projectPath, files)
})

ipcMain.handle('git:commit', async (_event, projectPath: string, message: string) => {
  validateProjectPath(projectPath)
  if (typeof message !== 'string' || message.length === 0 || message.length > 10000) {
    throw new Error('Invalid commit message')
  }
  return gitService?.commit(projectPath, message)
})

ipcMain.handle('git:discard-files', async (_event, projectPath: string, files: unknown) => {
  validateProjectPath(projectPath)
  validateRelativeFilePaths(files)
  return gitService?.discardFiles(projectPath, files)
})

ipcMain.handle(
  'git:delete-untracked-files',
  async (_event, projectPath: string, files: unknown) => {
    validateProjectPath(projectPath)
    validateRelativeFilePaths(files)
    return gitService?.deleteUntrackedFiles(projectPath, files)
  }
)

ipcMain.handle(
  'git:get-index-file-content',
  async (_event, projectPath: string, filePath: string) => {
    validateProjectPath(projectPath)
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 1000) {
      throw new Error('Invalid file path')
    }
    if (filePath.includes('..') || filePath.startsWith(':')) {
      throw new Error('Invalid file path')
    }
    return gitService?.getIndexFileContent(projectPath, filePath) ?? null
  }
)

ipcMain.handle('git:list-branches', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.listBranches(projectPath) ?? []
})

ipcMain.handle('git:create-branch', async (_event, projectPath: string, name: string) => {
  validateProjectPath(projectPath)
  validateBranchName(name)
  return gitService?.createBranch(projectPath, name)
})

ipcMain.handle('git:switch-branch', async (_event, projectPath: string, name: string) => {
  validateProjectPath(projectPath)
  validateBranchName(name)
  return gitService?.switchBranch(projectPath, name)
})

ipcMain.handle(
  'git:delete-branch',
  async (_event, projectPath: string, name: string, force: unknown) => {
    validateProjectPath(projectPath)
    validateBranchName(name)
    const forceDelete = typeof force === 'boolean' ? force : false
    return gitService?.deleteBranch(projectPath, name, forceDelete)
  }
)

// IPC Handlers for Session Index operations
ipcMain.handle('session-index:getForProject', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return sessionIndexService?.getSessionsForProject(projectPath) ?? []
})

// IPC Handlers for Tasks operations
ipcMain.handle('tasks:scan', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return taskService?.parseAllTasks(projectPath) ?? null
})

ipcMain.handle(
  'tasks:update',
  async (
    _event,
    projectPath: string,
    update: {
      filePath: string
      lineNumber: number
      action: 'toggle' | 'edit' | 'delete'
      newText?: string
    }
  ) => {
    validateProjectPath(projectPath)
    update.filePath = validateFilePathInProject(update.filePath)
    if (
      typeof update.lineNumber !== 'number' ||
      update.lineNumber < 1 ||
      update.lineNumber > 100000
    ) {
      throw new Error('Invalid line number')
    }
    if (!['toggle', 'edit', 'delete'].includes(update.action)) {
      throw new Error('Invalid action')
    }
    if (
      update.action === 'edit' &&
      (typeof update.newText !== 'string' ||
        update.newText.length === 0 ||
        update.newText.length > 10000)
    ) {
      throw new Error('Invalid newText')
    }
    return taskService?.updateTask(projectPath, update) ?? null
  }
)

ipcMain.handle(
  'tasks:add',
  async (
    _event,
    projectPath: string,
    task: { filePath: string; section: string; text: string }
  ) => {
    validateProjectPath(projectPath)
    task.filePath = validateFilePathInProject(task.filePath)
    if (
      typeof task.section !== 'string' ||
      task.section.length === 0 ||
      task.section.length > 200
    ) {
      throw new Error('Invalid section name')
    }
    if (typeof task.text !== 'string' || task.text.length === 0 || task.text.length > 10000) {
      throw new Error('Invalid task text')
    }
    return taskService?.addTask(projectPath, task) ?? null
  }
)

ipcMain.handle(
  'tasks:delete',
  async (_event, projectPath: string, filePath: string, lineNumber: number) => {
    validateProjectPath(projectPath)
    filePath = validateFilePathInProject(filePath)
    if (typeof lineNumber !== 'number' || lineNumber < 1 || lineNumber > 100000) {
      throw new Error('Invalid line number')
    }
    return taskService?.deleteTask(projectPath, filePath, lineNumber) ?? null
  }
)

ipcMain.handle(
  'tasks:move',
  async (
    _event,
    projectPath: string,
    move: { filePath: string; lineNumber: number; targetSection: string }
  ) => {
    validateProjectPath(projectPath)
    move.filePath = validateFilePathInProject(move.filePath)
    if (typeof move.lineNumber !== 'number' || move.lineNumber < 1 || move.lineNumber > 100000) {
      throw new Error('Invalid line number')
    }
    if (
      typeof move.targetSection !== 'string' ||
      move.targetSection.length === 0 ||
      move.targetSection.length > 200
    ) {
      throw new Error('Invalid target section')
    }
    return taskService?.moveTask(projectPath, move) ?? null
  }
)

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

// IPC Handler for plan-usage polling. One toggle drives both providers; each
// service self-gates (Codex pushes nothing without ~/.codex/auth.json).
ipcMain.handle('usage:set-enabled', async (_event, enabled: boolean) => {
  if (typeof enabled !== 'boolean') {
    throw new Error('Invalid enabled flag')
  }
  usageService?.setEnabled(enabled)
  codexUsageService?.setEnabled(enabled)
})

// IPC Handlers for Worktree operations
ipcMain.handle(
  'worktree:create',
  async (
    _event,
    projectId: string,
    branchName: string,
    worktreeName?: string,
    sourceBranch?: string
  ) => {
    if (!isValidUUID(projectId)) {
      throw new Error('Invalid project ID')
    }
    if (typeof branchName !== 'string' || branchName.length === 0 || branchName.length > 200) {
      throw new Error('Invalid branch name')
    }
    if (branchName.startsWith('-')) {
      throw new Error('Branch name must not start with "-"')
    }
    if (worktreeName !== undefined) {
      if (
        typeof worktreeName !== 'string' ||
        worktreeName.length === 0 ||
        worktreeName.length > 200
      ) {
        throw new Error('Invalid worktree name')
      }
      if (/[/\\]|\.\./.test(worktreeName)) {
        throw new Error('Worktree name must not contain path separators or ".."')
      }
    }
    if (sourceBranch !== undefined) {
      if (
        typeof sourceBranch !== 'string' ||
        sourceBranch.length === 0 ||
        sourceBranch.length > 200
      ) {
        throw new Error('Invalid source branch name')
      }
      if (sourceBranch.startsWith('-')) {
        throw new Error('Source branch name must not start with "-"')
      }
    }

    const projects = projectPersistence?.getProjects() ?? []
    const project = projects.find((p) => p.id === projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Create the worktree using git
    const result = await worktreeService!.createWorktree(
      project.path,
      branchName,
      worktreeName,
      sourceBranch
    )

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
  }
)

ipcMain.handle('worktree:list', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }

  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find((p) => p.id === projectId)

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
        .filter((wt) => !wt.isMain) // Skip main worktree (project root)
        .map((wt) => path.normalize(wt.path).toLowerCase())
    )

    const persistedPathMap = new Map(
      persistedWorktrees.map((wt) => [path.normalize(wt.path).toLowerCase(), wt])
    )

    // Add worktrees that exist in git but not in persistence
    for (const gitWorktree of gitWorktrees) {
      if (gitWorktree.isMain) continue // Skip main worktree

      const normalizedPath = path.normalize(gitWorktree.path).toLowerCase()
      if (!persistedPathMap.has(normalizedPath)) {
        // Derive name from directory basename, fallback to branch name
        const dirName = path.basename(gitWorktree.path)
        const name =
          dirName && dirName.length > 1 && !/^[A-Z]:$/i.test(dirName)
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
    mainLog.error('Failed to sync worktrees:', error)
    // Fallback to persisted worktrees if sync fails
    return projectPersistence.getWorktrees(projectId)
  }
})

ipcMain.handle('worktree:list-branches', async (_event, projectId: string) => {
  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }

  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find((p) => p.id === projectId)
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
  const project = projects.find((p) => p.id === worktree.projectId)
  if (!project) {
    throw new Error(`Project not found: ${worktree.projectId}`)
  }

  // Validate worktree path is within the managed .worktrees directory
  if (!worktreeService!.isWorktreePath(project.path, worktree.path)) {
    throw new Error('Worktree path is outside the managed directory')
  }

  // Remove the worktree using git
  await worktreeService!.removeWorktree(project.path, worktree.path, force)

  // Delete the local branch now that the worktree is gone
  if (worktree.branch) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'git',
          ['branch', '-D', '--', worktree.branch],
          { cwd: project.path, timeout: 10_000 },
          (err) => {
            if (err) reject(err)
            else resolve()
          }
        )
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

// IPC Handlers for clipboard operations.
// The renderer runs on a file:// origin in the packaged app, which is not a
// secure context, so navigator.clipboard is unavailable/blocked there. Routing
// copy/paste through Electron's main-process clipboard module makes it work
// regardless of renderer origin, secure context, or permission handlers.
ipcMain.on('clipboard:writeText', (_event, text: unknown) => {
  const safe = sanitizeClipboardText(text)
  if (safe === null) return
  clipboard.writeText(safe)
})

ipcMain.handle('clipboard:readText', async () => {
  return clipboard.readText()
})

// Write an image (a browser-annotation screenshot) to the OS clipboard so it
// can be pasted into a Claude chat via the CLI's image-paste shortcut. Payload
// is a base64 image data URL from the renderer's webview.capturePage(). Two
// gates: sanitizeClipboardImage bounds/validates the URL, and isEmpty() rejects
// anything nativeImage couldn't decode.
ipcMain.on('clipboard:writeImage', (_event, dataUrl: unknown) => {
  const safe = sanitizeClipboardImage(dataUrl)
  if (safe === null) return
  const image = nativeImage.createFromDataURL(safe)
  if (image.isEmpty()) return
  clipboard.writeImage(image)
})

// IPC Handlers for Shell operations
function validateShellPath(targetPath: unknown): string {
  if (typeof targetPath !== 'string' || targetPath.length === 0 || targetPath.length > 1000) {
    throw new Error('Invalid path')
  }
  const projects = projectPersistence?.getProjects() ?? []
  const isKnownProject = projects.some((p) => p.path === targetPath)
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
  if (typeof url !== 'string') {
    throw new Error('URL must be a string')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP/HTTPS URLs allowed')
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed')
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

ipcMain.handle('app:open-crash-log', async () => {
  const logPath = crashLogger.getLogPath()
  try {
    await shell.openPath(logPath)
    return { success: true, path: logPath }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

// Mirrors app:open-crash-log for the regular (electron-log) log file
ipcMain.handle('app:open-log-file', async () => {
  const logPath = getLogFilePath()
  if (!logPath) {
    return { success: false, error: 'Log file not initialized' }
  }
  try {
    await shell.openPath(logPath)
    return { success: true, path: logPath }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

// Sync theme to Claude Code's config (~/.claude.json)
ipcMain.handle('app:sync-claude-theme', async (_event, theme: 'light' | 'dark') => {
  if (theme !== 'light' && theme !== 'dark') return
  const claudeConfigPath = path.join(os.homedir(), '.claude.json')
  try {
    let config: Record<string, unknown> = {}
    try {
      const content = await fs.readFile(claudeConfigPath, 'utf-8')
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = parsed
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    config.theme = theme
    const tempPath = `${claudeConfigPath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8')
    await fs.rename(tempPath, claudeConfigPath)
  } catch (e) {
    appLog.warn('Failed to sync Claude theme:', e)
  }
})

// IPC Handlers for Update operations
ipcMain.handle('update:check', async () => {
  return updateService?.checkForUpdates()
})

ipcMain.handle('update:download', async () => {
  return updateService?.downloadUpdate()
})

ipcMain.handle('update:install', async () => {
  if (!updateService) return

  // Set flag early so before-quit/window-all-closed skip their cleanup
  updateService.isUpdateInProgress = true

  // Kill all child processes BEFORE triggering the NSIS installer.
  // Without this, node-pty processes block the installer from starting.
  await commandServer?.stop().catch(() => {})
  terminalManager?.destroy()
  hookWatcher?.destroy()
  githubService?.destroy()
  usageService?.destroy()
  codexUsageService?.destroy()
  await fileWatcherService?.stopAll().catch(() => {})
  await automationService?.destroy().catch(() => {})

  // Let OS fully reap child processes before spawning installer
  const PROCESS_CLEANUP_DELAY_MS = 500
  await new Promise((resolve) => setTimeout(resolve, PROCESS_CLEANUP_DELAY_MS))

  updateService.quitAndInstall()
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

  const projectId =
    typeof data.projectId === 'string' && isValidUUID(data.projectId) ? data.projectId : ''
  if (!projectId) throw new Error('A valid project is required')

  const defaultTarget: 'chat' | 'worktree' = data.defaultTarget === 'chat' ? 'chat' : 'worktree'

  return automationService.createAutomation({
    name,
    prompt,
    projectId,
    defaultTarget,
    trigger: validateTrigger(data.trigger),
    enabled: data.enabled !== false,
    baseBranch: typeof data.baseBranch === 'string' ? data.baseBranch : undefined,
    timeoutMinutes:
      typeof data.timeoutMinutes === 'number' ? clamp(data.timeoutMinutes, 1, 120) : 30,
  })
})

ipcMain.handle(
  'automation:update',
  async (_event, id: string, updates: Record<string, unknown>) => {
    if (!isValidUUID(id)) throw new Error('Invalid automation ID')
    if (!automationService) throw new Error('AutomationService not initialized')
    const allowedUpdates: Record<string, unknown> = {}
    if (typeof updates.name === 'string') allowedUpdates.name = updates.name.slice(0, 100)
    if (typeof updates.prompt === 'string') allowedUpdates.prompt = updates.prompt.slice(0, 50000)
    if (typeof updates.projectId === 'string' && isValidUUID(updates.projectId))
      allowedUpdates.projectId = updates.projectId
    if (updates.defaultTarget === 'chat' || updates.defaultTarget === 'worktree')
      allowedUpdates.defaultTarget = updates.defaultTarget
    if (updates.trigger) allowedUpdates.trigger = validateTrigger(updates.trigger)
    if (typeof updates.enabled === 'boolean') allowedUpdates.enabled = updates.enabled
    if (typeof updates.baseBranch === 'string') allowedUpdates.baseBranch = updates.baseBranch
    if (typeof updates.timeoutMinutes === 'number')
      allowedUpdates.timeoutMinutes = clamp(updates.timeoutMinutes as number, 1, 120)
    return automationService.updateAutomation(id, allowedUpdates)
  }
)

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

  // Single-project model: run headless for the automation's one project.
  const project = projectPersistence.getProjects().find((p) => p.id === automation.projectId)
  if (!project) throw new Error('Automation project not found')

  // Fire and forget - don't await, let it run in background
  automationService.triggerRun(id, project.path, project.id).catch((err) => {
    automationLog.error(`Run failed for ${id}:`, err)
  })
})

ipcMain.handle(
  'automation:record-launch',
  async (_event, automationId: string, opts: { terminalId?: string; worktreeBranch?: string }) => {
    if (!isValidUUID(automationId)) throw new Error('Invalid automation ID')
    if (!opts || !isValidUUID(opts.terminalId ?? '')) throw new Error('Invalid terminal ID')
    return (
      automationService?.recordForegroundLaunch(automationId, {
        terminalId: opts.terminalId as string,
        worktreeBranch:
          typeof opts.worktreeBranch === 'string'
            ? opts.worktreeBranch.slice(0, 200)
            : undefined,
      }) ?? null
    )
  }
)

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

ipcMain.handle('automation:clear-all-runs', async () => {
  automationService?.clearAllRuns()
})

ipcMain.handle('automation:get-next-run', async (_event, automationId: string) => {
  if (!isValidUUID(automationId)) throw new Error('Invalid automation ID')
  return automationService?.getNextRunTime(automationId) ?? null
})

ipcMain.handle('automation:check-pr', async (_event, runId: string) => {
  if (!isValidUUID(runId)) throw new Error('Invalid run ID')
  return automationService?.checkPRForRun(runId) ?? null
})

// Harden every <webview> guest (the built-in browser). None of the content a
// guest loads is trusted — local HTML, localhost, or external pages — so the
// main process re-derives its security config at attach time (renderer-set
// element attributes are not a trusted boundary) and keeps popups out of new
// unsandboxed windows. A guest can never reach Node or the preload bridge.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_e, webPreferences, params) => {
    hardenWebviewPreferences(webPreferences, params)
  })

  if (contents.getType() === 'webview') {
    // Browser shortcuts pressed while the guest has focus never reach the host
    // renderer (the guest captures its own key events), so intercept them here
    // and forward the intent to the active browser tab. Default bindings only —
    // see utils/browserShortcut.ts for the rationale on why config isn't synced.
    contents.on('before-input-event', (event, input) => {
      const action = matchBrowserShortcut(input)
      if (action) {
        event.preventDefault()
        win?.webContents.send('browser:shortcut', action)
      }
    })

    // Popups open in the OS browser, never a new unsandboxed window. Mirror the
    // main window's credential guard so a hostile page can't hand
    // http://user:pass@... to the OS browser.
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url)
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          !parsed.username &&
          !parsed.password
        ) {
          shell.openExternal(url)
        }
      } catch {
        // Invalid URL, ignore
      }
      return { action: 'deny' }
    })

    // Defense-in-depth: keep the guest on web/file schemes; block custom or
    // unexpected schemes from navigating it.
    const guardNavigation = (event: Electron.Event, url: string) => {
      try {
        const { protocol } = new URL(url)
        if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') {
          event.preventDefault()
        }
      } catch {
        event.preventDefault()
      }
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
  }
})

app.whenReady().then(async () => {
  // Deny all permission requests for the untrusted browser session by default
  // (no browser-grade permission UX yet). Pages loaded in the <webview> cannot
  // silently gain camera/mic/geolocation/notifications/etc.
  session
    .fromPartition(BROWSER_PARTITION)
    .setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  await createWindow()

  // Restore sessions once the renderer store is hydrated (with fallback timeout)
  let sessionsRestored = false
  const doRestore = () => {
    if (sessionsRestored) return
    sessionsRestored = true
    restoreSessions().catch((err) => {
      mainLog.error('Session restoration failed:', err)
    })
  }
  ipcMain.once('store:hydrated', (_event) => doRestore())
  setTimeout(doRestore, 3000) // Fallback if hydration signal never arrives

  // Check for updates after app is loaded (with delay to not block UI)
  setTimeout(() => {
    if (app.isPackaged) {
      updateService?.checkForUpdates().catch((err) => {
        mainLog.error('Auto update check failed:', err)
      })
    }
  }, 5000) // 5 second delay

  // Check for missed automation runs on wake from sleep
  powerMonitor.on('resume', () => {
    powerLog.info('System resumed from sleep, checking missed automation runs')
    automationService?.checkMissedRuns()
  })
})

app.on('before-quit', () => {
  // A real quit is underway — let the main window's close handler proceed
  // instead of hiding to tray.
  isQuitting = true

  // Skip cleanup and session persistence during update — services already
  // destroyed in update:install handler, sessions will be restored after restart
  if (updateService?.isUpdateInProgress) return

  // Persist Claude sessions for restoration on next startup
  if (hookWatcher && terminalManager && projectPersistence) {
    const terminalSessions = hookWatcher.getTerminalSessions()
    const sessionsToSave: PersistedSession[] = []

    for (const { terminalId, sessionId } of terminalSessions) {
      const info = terminalManager.getTerminalInfo(terminalId)
      // Only hook-capable agents (claude, codex) report a session id and can be
      // resumed. Others never reach getTerminalSessions, but gate defensively.
      if (info && isHookCapableAgent(info.type)) {
        const summaryData = sessionIndexService?.getSessionSummary(sessionId)
        sessionsToSave.push({
          terminalId,
          projectId: info.projectId,
          worktreeId: info.worktreeId ?? null,
          claudeSessionId: sessionId,
          agentType: info.type,
          cwd: info.cwd,
          title: info.title ?? '',
          closedAt: Date.now(),
          summary: summaryData?.summary || summaryData?.firstPrompt,
        })
      }
    }

    if (sessionsToSave.length > 0) {
      sessionLog.info(`Persisting ${sessionsToSave.length} sessions for restoration`)
      projectPersistence.setSessions(sessionsToSave)
    }
  }

  // Stop automations (kills running processes, marks runs as failed)
  automationService?.destroy().catch((err) => {
    automationServiceLog.error('Cleanup error:', err)
  })

  // Stop file watchers before terminal cleanup to avoid EBUSY
  fileWatcherService?.stopAll().catch((err) => {
    fileWatcherLog.error('Cleanup error:', err)
  })
  // Stop CommandServer
  commandServer?.stop().catch((err) => {
    commandServerLog.error('Cleanup error:', err)
  })
  unsubSessionIndex?.()
  sessionIndexService?.destroy()
  hookWatcher?.destroy()
  githubService?.destroy()
  usageService?.destroy()
  codexUsageService?.destroy()
  notchService?.destroy()
  tray?.destroy()
  terminalManager?.destroy()
})

app.on('window-all-closed', () => {
  // Skip cleanup if we're installing an update — already cleaned up in update:install handler
  if (updateService?.isUpdateInProgress) {
    win = null
    return
  }
  hookWatcher?.destroy()
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
