import { ipcRenderer, contextBridge } from 'electron'

console.log('[PRELOAD] Script starting...')

// Type definitions for the exposed API - Claude Code states (5 states)
type TerminalState = 'busy' | 'permission' | 'question' | 'done' | 'stopped'

// Whitelist of channels that can have listeners removed
const ALLOWED_LISTENER_CHANNELS = [
  'terminal:data',
  'terminal:state',
  'terminal:exit',
  'terminal:title',
  'session:restored',
  'app:close-request',
  'update:checking',
  'update:available',
  'update:not-available',
  'update:progress',
  'update:downloaded',
  'update:error',
  'github:pr-status-update',
  'fs:fileChanged',
  'fs:watch:changes',
  'fs:watch:error',
] as const

// NOTE: ProjectType duplicated here due to Electron process isolation. Keep in sync with src/types/index.ts
type ProjectType = 'workspace' | 'project' | 'code'

interface ProjectSettings {
  dangerouslySkipPermissions?: boolean
}

interface Project {
  id: string
  name: string
  path: string
  type: ProjectType
  createdAt: number
  sortOrder: number
  settings?: ProjectSettings
}

interface Worktree {
  id: string
  projectId: string
  name: string
  branch: string
  path: string
  createdAt: number
  isLocked: boolean
}

interface BranchList {
  local: string[]
  remote: string[]
  current: string | null
}

interface FileSystemEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
}

interface GitFileChange {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  staged: boolean
}

interface GitBranchInfo {
  name: string
  upstream: string | null
  ahead: number
  behind: number
}

interface GitStatus {
  isGitRepo: boolean
  branch: GitBranchInfo | null
  staged: GitFileChange[]
  modified: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  isClean: boolean
  error?: string
}

interface GitCommit {
  hash: string
  shortHash: string
  message: string
  authorName: string
  authorDate: string
  parentHashes: string[]
}

interface GitCommitFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  oldPath?: string
}

interface GitCommitDetail {
  hash: string
  fullMessage: string
  authorName: string
  authorEmail: string
  authorDate: string
  files: GitCommitFile[]
  isMerge: boolean
  parentHashes: string[]
}

interface GitCommitLog {
  commits: GitCommit[]
  hasMore: boolean
}

// Task types
interface TaskItem {
  id: string
  text: string
  completed: boolean
  section: string
  filePath: string
  lineNumber: number
  dueDate?: string
  personTags?: string[]
  isOverdue?: boolean
  isDueToday?: boolean
}

interface TaskSection {
  name: string
  priority: number
  tasks: TaskItem[]
}

interface TasksData {
  sections: TaskSection[]
  files: string[]
  totalOpen: number
  nowCount: number
}

interface TaskUpdate {
  filePath: string
  lineNumber: number
  action: 'toggle' | 'edit' | 'delete'
  newText?: string
}

interface TaskMove {
  filePath: string
  lineNumber: number
  targetSection: string
}

interface TaskAdd {
  filePath: string
  section: string
  text: string
}

// Update types
interface PRCheckStatus {
  name: string
  state: string
  bucket: string
}

interface PRStatus {
  noPR: boolean
  number?: number
  title?: string
  url?: string
  state?: 'OPEN' | 'CLOSED' | 'MERGED'
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus?: 'CLEAN' | 'DIRTY' | 'BLOCKED' | 'UNSTABLE' | 'UNKNOWN'
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  statusCheckRollup?: PRCheckStatus[]
  additions?: number
  deletions?: number
  changedFiles?: number
  loading?: boolean
  error?: string
  lastUpdated?: number
}

interface UpdateCheckResult {
  updateAvailable: boolean
  version?: string
  currentVersion?: string
  isDev?: boolean
}

interface UpdateAvailableInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string | null
}

interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

interface UpdateDownloadedInfo {
  version: string
}

interface UpdateErrorInfo {
  message: string
}

// Unsubscribe function type
type Unsubscribe = () => void

// Expose secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Terminal operations
  terminal: {
    create: (projectId: string, worktreeId?: string, type?: 'claude' | 'normal'): Promise<string> =>
      ipcRenderer.invoke('terminal:create', projectId, worktreeId, type),

    write: (terminalId: string, data: string): void =>
      ipcRenderer.send('terminal:write', terminalId, data),

    resize: (terminalId: string, cols: number, rows: number): void =>
      ipcRenderer.send('terminal:resize', terminalId, cols, rows),

    close: (terminalId: string): void =>
      ipcRenderer.send('terminal:close', terminalId),

    // Events from main process - return unsubscribe functions for cleanup
    onData: (callback: (id: string, data: string) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },

    onStateChange: (callback: (id: string, state: TerminalState) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, state: TerminalState) => callback(id, state)
      ipcRenderer.on('terminal:state', handler)
      return () => ipcRenderer.removeListener('terminal:state', handler)
    },

    onExit: (callback: (id: string, code: number) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, code: number) => callback(id, code)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },

    onTitleChange: (callback: (id: string, title: string) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, title: string) => callback(id, title)
      ipcRenderer.on('terminal:title', handler)
      return () => ipcRenderer.removeListener('terminal:title', handler)
    },

    onSessionRestored: (callback: (session: { terminalId: string; projectId: string; worktreeId: string | null; title: string }) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, session: { terminalId: string; projectId: string; worktreeId: string | null; title: string }) => callback(session)
      ipcRenderer.on('session:restored', handler)
      return () => ipcRenderer.removeListener('session:restored', handler)
    },
  },

  // Project operations
  project: {
    list: (): Promise<Project[]> =>
      ipcRenderer.invoke('project:list'),

    add: (path: string, name?: string, type?: ProjectType): Promise<Project> =>
      ipcRenderer.invoke('project:add', path, name, type),

    remove: (id: string): Promise<void> =>
      ipcRenderer.invoke('project:remove', id),

    update: (id: string, updates: Partial<Pick<Project, 'name' | 'settings'>>): Promise<Project | null> =>
      ipcRenderer.invoke('project:update', id, updates),

    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('project:select-folder'),

    reorder: (projectIds: string[]): Promise<Project[]> =>
      ipcRenderer.invoke('project:reorder', projectIds),
  },

  // Worktree operations
  worktree: {
    create: (projectId: string, branchName: string, worktreeName?: string): Promise<Worktree> =>
      ipcRenderer.invoke('worktree:create', projectId, branchName, worktreeName),

    list: (projectId: string): Promise<Worktree[]> =>
      ipcRenderer.invoke('worktree:list', projectId),

    listBranches: (projectId: string): Promise<BranchList> =>
      ipcRenderer.invoke('worktree:list-branches', projectId),

    remove: (worktreeId: string, force?: boolean): Promise<void> =>
      ipcRenderer.invoke('worktree:remove', worktreeId, force ?? false),

    hasChanges: (worktreeId: string): Promise<boolean> =>
      ipcRenderer.invoke('worktree:has-changes', worktreeId),
  },

  // Shell operations
  shell: {
    openPath: (path: string): Promise<string> =>
      ipcRenderer.invoke('shell:open-path', path),

    openInEditor: (path: string): Promise<void> =>
      ipcRenderer.invoke('shell:open-in-editor', path),

    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:open-external', url),
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('shell:show-item-in-folder', filePath),
  },

  // Notification operations
  notification: {
    show: (title: string, body: string): void =>
      ipcRenderer.send('notification:show', title, body),
  },

  // App lifecycle
  app: {
    onCloseRequest: (callback: () => void): Unsubscribe => {
      const handler = () => callback()
      ipcRenderer.on('app:close-request', handler)
      return () => ipcRenderer.removeListener('app:close-request', handler)
    },

    confirmClose: (): void =>
      ipcRenderer.send('app:confirm-close'),

    cancelClose: (): void =>
      ipcRenderer.send('app:cancel-close'),
  },

  // File system operations
  fs: {
    readDirectory: (dirPath: string): Promise<FileSystemEntry[]> =>
      ipcRenderer.invoke('fs:readDirectory', dirPath),
    readFile: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    watchFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('fs:watchFile', filePath),
    unwatchFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('fs:unwatchFile', filePath),
    onFileChanged: (callback: (filePath: string) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath)
      ipcRenderer.on('fs:fileChanged', handler)
      return () => ipcRenderer.removeListener('fs:fileChanged', handler)
    },
    onWatchChanges: (callback: (events: Array<{ type: string; projectId: string; path: string }>) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, events: Array<{ type: string; projectId: string; path: string }>) => callback(events)
      ipcRenderer.on('fs:watch:changes', handler)
      return () => ipcRenderer.removeListener('fs:watch:changes', handler)
    },
    onWatchError: (callback: (error: { projectId: string; error: string }) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, error: { projectId: string; error: string }) => callback(error)
      ipcRenderer.on('fs:watch:error', handler)
      return () => ipcRenderer.removeListener('fs:watch:error', handler)
    },
    stat: (filePath: string): Promise<{ exists: boolean; isFile: boolean; resolved: string }> =>
      ipcRenderer.invoke('fs:stat', filePath),
    createFile: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('fs:createFile', filePath),
    createDirectory: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:createDirectory', dirPath),
    rename: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    delete: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:delete', targetPath),
  },

  // Git operations
  git: {
    getStatus: (projectPath: string): Promise<GitStatus> =>
      ipcRenderer.invoke('git:status', projectPath),
    fetch: (projectPath: string): Promise<string> =>
      ipcRenderer.invoke('git:fetch', projectPath),
    pull: (projectPath: string): Promise<string> =>
      ipcRenderer.invoke('git:pull', projectPath),
    push: (projectPath: string): Promise<string> =>
      ipcRenderer.invoke('git:push', projectPath),
    getRemoteUrl: (projectPath: string): Promise<string | null> =>
      ipcRenderer.invoke('git:get-remote-url', projectPath),
    getCommitLog: (projectPath: string, skip?: number, limit?: number): Promise<GitCommitLog> =>
      ipcRenderer.invoke('git:commit-log', projectPath, skip, limit),
    getCommitDetail: (projectPath: string, commitHash: string): Promise<GitCommitDetail | null> =>
      ipcRenderer.invoke('git:commit-detail', projectPath, commitHash),
    getFileAtCommit: (projectPath: string, commitHash: string, filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('git:file-at-commit', projectPath, commitHash, filePath),
    getHeadHash: (projectPath: string): Promise<string | null> =>
      ipcRenderer.invoke('git:head-hash', projectPath),
  },

  // Task operations
  tasks: {
    scan: (projectPath: string): Promise<TasksData> =>
      ipcRenderer.invoke('tasks:scan', projectPath),
    update: (projectPath: string, update: TaskUpdate): Promise<TasksData> =>
      ipcRenderer.invoke('tasks:update', projectPath, update),
    add: (projectPath: string, task: TaskAdd): Promise<TasksData> =>
      ipcRenderer.invoke('tasks:add', projectPath, task),
    delete: (projectPath: string, filePath: string, lineNumber: number): Promise<TasksData> =>
      ipcRenderer.invoke('tasks:delete', projectPath, filePath, lineNumber),
    move: (projectPath: string, move: TaskMove): Promise<TasksData> =>
      ipcRenderer.invoke('tasks:move', projectPath, move),
    createFile: (projectPath: string): Promise<string> =>
      ipcRenderer.invoke('tasks:create-file', projectPath),
  },

  // GitHub operations
  github: {
    checkAvailable: (): Promise<{ installed: boolean; authenticated: boolean }> =>
      ipcRenderer.invoke('github:check-available'),

    getPRStatus: (projectPath: string): Promise<PRStatus> =>
      ipcRenderer.invoke('github:get-pr-status', projectPath),

    mergePR: (projectPath: string, prNumber: number): Promise<void> =>
      ipcRenderer.invoke('github:merge-pr', projectPath, prNumber),

    startPolling: (key: string, projectPath: string): Promise<void> =>
      ipcRenderer.invoke('github:start-polling', key, projectPath),

    stopPolling: (key: string): Promise<void> =>
      ipcRenderer.invoke('github:stop-polling', key),

    onPRStatusUpdate: (callback: (key: string, status: PRStatus) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, key: string, status: PRStatus) => callback(key, status)
      ipcRenderer.on('github:pr-status-update', handler)
      return () => ipcRenderer.removeListener('github:pr-status-update', handler)
    },
  },

  // Update operations
  update: {
    check: (): Promise<UpdateCheckResult> =>
      ipcRenderer.invoke('update:check'),

    download: (): Promise<{ success: boolean; isDev?: boolean }> =>
      ipcRenderer.invoke('update:download'),

    install: (): Promise<void> =>
      ipcRenderer.invoke('update:install'),

    getVersion: (): Promise<string> =>
      ipcRenderer.invoke('update:get-version'),

    // Events from main process
    onChecking: (callback: () => void): Unsubscribe => {
      const handler = () => callback()
      ipcRenderer.on('update:checking', handler)
      return () => ipcRenderer.removeListener('update:checking', handler)
    },

    onAvailable: (callback: (info: UpdateAvailableInfo) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, info: UpdateAvailableInfo) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },

    onNotAvailable: (callback: () => void): Unsubscribe => {
      const handler = () => callback()
      ipcRenderer.on('update:not-available', handler)
      return () => ipcRenderer.removeListener('update:not-available', handler)
    },

    onProgress: (callback: (progress: UpdateProgressInfo) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, progress: UpdateProgressInfo) => callback(progress)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },

    onDownloaded: (callback: (info: UpdateDownloadedInfo) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, info: UpdateDownloadedInfo) => callback(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },

    onError: (callback: (error: UpdateErrorInfo) => void): Unsubscribe => {
      const handler = (_event: Electron.IpcRendererEvent, error: UpdateErrorInfo) => callback(error)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    },
  },

  // Cleanup helper - only allows whitelisted channels (#003 fix)
  removeAllListeners: (channel: string): void => {
    if (ALLOWED_LISTENER_CHANNELS.includes(channel as typeof ALLOWED_LISTENER_CHANNELS[number])) {
      ipcRenderer.removeAllListeners(channel)
    }
  },
})

// Loading indicator (from original template)
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

function useLoading() {
  const styleContent = `
    .app-loading-wrap {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1a1b26;
      z-index: 9;
    }
    .app-loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #414868;
      border-top-color: #7aa2f7;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="app-loading-spinner"></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)
