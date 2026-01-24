import { ipcRenderer, contextBridge } from 'electron'

console.log('[PRELOAD] Script starting...')

// Type definitions for the exposed API
type TerminalState = 'starting' | 'running' | 'needs_input' | 'stopped' | 'error'

// Whitelist of channels that can have listeners removed
const ALLOWED_LISTENER_CHANNELS = [
  'terminal:data',
  'terminal:state',
  'terminal:exit',
  'app:close-request',
] as const

interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  sortOrder: number
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

// Unsubscribe function type
type Unsubscribe = () => void

// Expose secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Terminal operations
  terminal: {
    create: (projectId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:create', projectId),

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
  },

  // Project operations
  project: {
    list: (): Promise<Project[]> =>
      ipcRenderer.invoke('project:list'),

    add: (path: string, name?: string): Promise<Project> =>
      ipcRenderer.invoke('project:add', path, name),

    remove: (id: string): Promise<void> =>
      ipcRenderer.invoke('project:remove', id),

    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('project:select-folder'),

    reorder: (projectIds: string[]): Promise<Project[]> =>
      ipcRenderer.invoke('project:reorder', projectIds),
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
  },

  // Git operations
  git: {
    getStatus: (projectPath: string): Promise<GitStatus> =>
      ipcRenderer.invoke('git:status', projectPath),
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
