// IPC contract types are declared once in shared/ipc-types.ts (single source
// for renderer, preload and main). Re-exported here so existing imports from
// '@/types' / '../types' keep working unchanged.
export type {
  ProjectType,
  AuthMode,
  ClaudeMode,
  AccountProfile,
  ProjectSettings,
  Project,
  Worktree,
  BranchList,
  TerminalState,
  TerminalType,
  Unsubscribe,
  TerminalSession,
  SessionIndexEntry,
  FileSystemEntry,
  GitFileChange,
  GitBranchInfo,
  GitStatus,
  GitCommit,
  GitCommitFile,
  GitCommitDetail,
  GitCommitLog,
  GitBranchListItem,
  PRCheckStatus,
  PRStatus,
  UsageWindow,
  UsageData,
  TaskItem,
  TaskSection,
  TasksData,
  TaskUpdate,
  TaskMove,
  TaskAdd,
  UpdateCheckResult,
  UpdateAvailableInfo,
  UpdateProgressInfo,
  UpdateDownloadedInfo,
  UpdateErrorInfo,
  RestoredSession,
  SpawnFailureCode,
  SpawnFailedEvent,
  UncaughtErrorEvent,
} from '@shared/ipc-types'

import type {
  Project,
  Worktree,
  BranchList,
  ProjectType,
  AccountProfile,
  TerminalState,
  TerminalType,
  Unsubscribe,
  TerminalSession,
  SessionIndexEntry,
  FileSystemEntry,
  GitStatus,
  GitCommitLog,
  GitCommitDetail,
  GitBranchListItem,
  PRStatus,
  UsageData,
  TasksData,
  TaskUpdate,
  TaskMove,
  TaskAdd,
  UpdateCheckResult,
  UpdateAvailableInfo,
  UpdateProgressInfo,
  UpdateDownloadedInfo,
  UpdateErrorInfo,
  RestoredSession,
  SpawnFailedEvent,
  UncaughtErrorEvent,
} from '@shared/ipc-types'

// Valid terminal states for runtime validation
export const VALID_TERMINAL_STATES: readonly TerminalState[] = [
  'busy',
  'permission',
  'question',
  'done',
  'stopped',
] as const

// Type guard for terminal state
export function isValidTerminalState(state: string): state is TerminalState {
  return VALID_TERMINAL_STATES.includes(state as TerminalState)
}

// Editor tab types
export interface EditorTab {
  id: string
  type: 'editor'
  filePath: string
  fileName: string
  isDirty: boolean
  projectId: string
  // Owning chat (terminal) id. Content tabs are scoped per-chat; '' when opened
  // without an active chat. Consumed by the second panel (per-chat content).
  terminalId: string
  isDeletedExternally?: boolean
}

// Diff tab types (read-only, for viewing commit diffs)
export interface DiffTab {
  id: string
  type: 'diff'
  filePath: string
  fileName: string
  commitHash: string
  parentHash: string // empty string for initial commits
  oldPath?: string // original path for renamed files (used to fetch parent commit content)
  projectId: string
  terminalId: string
}

// Working tree diff tab (for viewing uncommitted changes)
export interface WorkingTreeDiffTab {
  id: string
  type: 'working-tree-diff'
  filePath: string
  fileName: string
  diffKind: 'staged' | 'unstaged' | 'untracked' | 'deleted'
  projectId: string
  terminalId: string
}

// Browser tab: a real Electron <webview> that navigates a URL. Loads local
// HTML files, the user's own localhost app, and (at their own risk) external
// URLs. When it backs a local file, filePath/fileName are set so the tab is
// titled by filename, de-duplicated per file, and live-reloaded on disk change.
export interface BrowserTab {
  id: string
  type: 'browser'
  url: string
  projectId: string
  terminalId: string
  filePath?: string
  fileName?: string
}

// Union of all center tab types
export type CenterTab = EditorTab | DiffTab | WorkingTreeDiffTab | BrowserTab

// File watcher types
export const FILE_WATCH_EVENT_TYPES = [
  'file-added',
  'file-changed',
  'file-removed',
  'dir-added',
  'dir-removed',
] as const

export type FileWatchEventType = (typeof FILE_WATCH_EVENT_TYPES)[number]

export interface FileWatchEvent {
  type: FileWatchEventType
  projectId: string
  path: string // normalized absolute path with forward slashes
}

export interface FileWatchError {
  projectId: string
  error: string
}

// Automation types
export type AutomationRunStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'

// Keep in sync with GitHubService.GitEvent (main process)
export type GitEvent = 'pr-merged' | 'pr-opened' | 'checks-passed' | 'merge-conflict'

export type AutomationTrigger =
  | { type: 'schedule'; cron: string }
  | { type: 'claude-done'; projectId?: string }
  | { type: 'git-event'; event: GitEvent }
  | { type: 'file-change'; patterns: string[]; cooldownSeconds: number }

export interface Automation {
  id: string
  name: string
  prompt: string
  projectIds: string[]
  trigger: AutomationTrigger
  enabled: boolean
  baseBranch?: string
  timeoutMinutes: number
  createdAt: string
  updatedAt: string
  lastRunAt?: string
}

export interface AutomationRun {
  id: string
  automationId: string
  projectId: string
  status: AutomationRunStatus
  startedAt: string
  completedAt?: string
  result?: string
  sessionId?: string
  exitCode?: number
  durationMs?: number
  error?: string
  read: boolean
  worktreeBranch?: string
  prUrl?: string
  prNumber?: number
}

// App state
export interface AppState {
  projects: Project[]
  terminals: Record<string, TerminalSession>
  activeProjectId: string | null
  activeTerminalId: string | null
}

export interface ElectronAPI {
  terminal: {
    create: (
      projectId: string,
      worktreeId?: string,
      type?: TerminalType,
      resumeSessionId?: string
    ) => Promise<string | null>
    write: (terminalId: string, data: string) => void
    resize: (terminalId: string, cols: number, rows: number) => void
    close: (terminalId: string) => void
    evict: (terminalId: string) => void
    restore: (terminalId: string) => void
    onData: (callback: (id: string, data: string) => void) => Unsubscribe
    onStateChange: (callback: (id: string, state: TerminalState) => void) => Unsubscribe
    onExit: (callback: (id: string, code: number) => void) => Unsubscribe
    updateWorktree: (
      terminalId: string,
      worktreeId: string,
      newCwd: string
    ) => Promise<{ success: boolean }>
    onTitleChange: (callback: (id: string, title: string) => void) => Unsubscribe
    onStatusMessage: (callback: (id: string, message: string) => void) => Unsubscribe
    onWorktreeUpdated: (callback: (id: string, worktreeId: string) => void) => Unsubscribe
    onSessionRestored: (callback: (session: RestoredSession) => void) => Unsubscribe
    onSidecarCreated: (
      callback: (contextKey: string, terminal: TerminalSession) => void
    ) => Unsubscribe
    onSummaryChange: (callback: (id: string, summary: string) => void) => Unsubscribe
    onGeneratedTitleChange: (callback: (id: string, title: string) => void) => Unsubscribe
    onSpawnFailed: (callback: (event: SpawnFailedEvent) => void) => Unsubscribe
  }
  editor: {
    onOpenFile: (
      callback: (data: {
        filePath: string
        fileName: string
        projectId: string
        line?: number
        terminalId?: string
      }) => void
    ) => Unsubscribe
    onOpenBrowser: (
      callback: (data: { url: string; projectId: string; terminalId?: string }) => void
    ) => Unsubscribe
  }
  sessionIndex: {
    getForProject: (projectPath: string) => Promise<SessionIndexEntry[]>
  }
  project: {
    list: () => Promise<Project[]>
    add: (path: string, name?: string, type?: ProjectType) => Promise<Project>
    remove: (id: string) => Promise<void>
    update: (
      id: string,
      updates: Partial<Pick<Project, 'name' | 'settings' | 'type'>>
    ) => Promise<Project | null>
    setPinned: (id: string, pinned: boolean) => Promise<Project | null>
    selectFolder: () => Promise<string | null>
    reorder: (projectIds: string[]) => Promise<Project[]>
    setActiveWatcher: (projectId: string) => Promise<void>
    hasVertexConfig: (projectId: string) => Promise<boolean>
  }
  profile: {
    list: () => Promise<AccountProfile[]>
    add: (name: string) => Promise<AccountProfile>
    update: (id: string, updates: { name: string }) => Promise<AccountProfile | null>
    remove: (id: string) => Promise<void>
    setActive: (id: string | null) => Promise<void>
    getActive: () => Promise<string | null>
    setEnvVars: (profileId: string, vars: Record<string, string>) => Promise<void>
    getEnvVarKeys: (profileId: string) => Promise<string[]>
    clearEnvVars: (profileId: string) => Promise<void>
  }
  worktree: {
    create: (
      projectId: string,
      branchName: string,
      worktreeName?: string,
      sourceBranch?: string
    ) => Promise<Worktree>
    list: (projectId: string) => Promise<Worktree[]>
    listBranches: (projectId: string) => Promise<BranchList>
    remove: (worktreeId: string, force?: boolean) => Promise<void>
    hasChanges: (worktreeId: string) => Promise<boolean>
    onWorktreeAdded: (callback: (projectId: string, worktree: Worktree) => void) => Unsubscribe
  }
  shell: {
    openPath: (path: string) => Promise<string>
    openInEditor: (path: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (filePath: string) => Promise<void>
  }
  clipboard: {
    writeText: (text: string) => void
    readText: () => Promise<string>
    writeImage: (dataUrl: string) => void
  }
  notification: {
    show: (title: string, body: string) => void
  }
  app: {
    onCloseRequest: (callback: () => void) => Unsubscribe
    confirmClose: () => void
    cancelClose: () => void
    storeHydrated: () => void
    syncClaudeTheme: (theme: 'light' | 'dark') => Promise<void>
    onUncaughtError: (callback: (event: UncaughtErrorEvent) => void) => Unsubscribe
    openCrashLog: () => Promise<{ success: boolean; path?: string; error?: string }>
    openLogFile: () => Promise<{ success: boolean; path?: string; error?: string }>
  }
  fs: {
    readDirectory: (dirPath: string) => Promise<FileSystemEntry[]>
    readFile: (filePath: string) => Promise<string>
    writeFile: (filePath: string, content: string) => Promise<void>
    onWatchChanges: (callback: (events: FileWatchEvent[]) => void) => Unsubscribe
    onWatchError: (callback: (error: FileWatchError) => void) => Unsubscribe
    stat: (filePath: string) => Promise<{ exists: boolean; isFile: boolean; resolved: string }>
    createFile: (filePath: string) => Promise<void>
    createDirectory: (dirPath: string) => Promise<void>
    rename: (oldPath: string, newPath: string) => Promise<void>
    delete: (targetPath: string) => Promise<void>
  }
  git: {
    getStatus: (projectPath: string) => Promise<GitStatus>
    fetch: (projectPath: string) => Promise<string>
    pull: (projectPath: string) => Promise<string>
    push: (projectPath: string) => Promise<string>
    getRemoteUrl: (projectPath: string) => Promise<string | null>
    getCommitLog: (projectPath: string, skip?: number, limit?: number) => Promise<GitCommitLog>
    getCommitDetail: (projectPath: string, commitHash: string) => Promise<GitCommitDetail | null>
    getFileAtCommit: (
      projectPath: string,
      commitHash: string,
      filePath: string
    ) => Promise<string | null>
    getHeadHash: (projectPath: string) => Promise<string | null>
    stageFiles: (projectPath: string, files: string[]) => Promise<void>
    unstageFiles: (projectPath: string, files: string[]) => Promise<void>
    commit: (projectPath: string, message: string) => Promise<string>
    discardFiles: (projectPath: string, files: string[]) => Promise<void>
    deleteUntrackedFiles: (projectPath: string, files: string[]) => Promise<void>
    getIndexFileContent: (projectPath: string, filePath: string) => Promise<string | null>
    listBranches: (projectPath: string) => Promise<GitBranchListItem[]>
    createBranch: (projectPath: string, name: string) => Promise<void>
    switchBranch: (projectPath: string, name: string) => Promise<void>
    deleteBranch: (projectPath: string, name: string, force: boolean) => Promise<void>
  }
  github: {
    checkAvailable: () => Promise<{ installed: boolean; authenticated: boolean }>
    // Rejects on transient gh failures (timeout, network, rate-limit). Callers
    // must catch and call markPRStatusStale to preserve last-known-good data.
    getPRStatus: (projectPath: string) => Promise<PRStatus>
    mergePR: (projectPath: string, prNumber: number) => Promise<void>
    startPolling: (key: string, projectPath: string) => Promise<void>
    stopPolling: (key: string) => Promise<void>
    onPRStatusUpdate: (callback: (key: string, status: PRStatus) => void) => Unsubscribe
    onPRStatusStale: (callback: (key: string, error: string) => void) => Unsubscribe
  }
  usage: {
    setEnabled: (enabled: boolean) => Promise<void>
    onUpdate: (callback: (data: UsageData) => void) => Unsubscribe
  }
  update: {
    check: () => Promise<UpdateCheckResult>
    download: () => Promise<{ success: boolean; isDev?: boolean }>
    install: () => Promise<void>
    getVersion: () => Promise<string>
    onChecking: (callback: () => void) => Unsubscribe
    onAvailable: (callback: (info: UpdateAvailableInfo) => void) => Unsubscribe
    onNotAvailable: (callback: () => void) => Unsubscribe
    onProgress: (callback: (progress: UpdateProgressInfo) => void) => Unsubscribe
    onDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => Unsubscribe
    onError: (callback: (error: UpdateErrorInfo) => void) => Unsubscribe
  }
  tasks: {
    scan: (projectPath: string) => Promise<TasksData>
    update: (projectPath: string, update: TaskUpdate) => Promise<TasksData>
    add: (projectPath: string, task: TaskAdd) => Promise<TasksData>
    delete: (projectPath: string, filePath: string, lineNumber: number) => Promise<TasksData>
    move: (projectPath: string, move: TaskMove) => Promise<TasksData>
    createFile: (projectPath: string) => Promise<string>
  }
  automation: {
    list: () => Promise<Automation[]>
    create: (automation: Omit<Automation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Automation>
    update: (
      id: string,
      updates: Partial<Omit<Automation, 'id' | 'createdAt'>>
    ) => Promise<Automation | null>
    delete: (id: string) => Promise<void>
    toggle: (id: string) => Promise<Automation | null>
    trigger: (id: string) => Promise<void>
    stopRun: (runId: string) => Promise<void>
    listRuns: (automationId?: string, limit?: number) => Promise<AutomationRun[]>
    markRead: (runId: string) => Promise<void>
    deleteRun: (runId: string) => Promise<void>
    clearAllRuns: () => Promise<void>
    getNextRun: (automationId: string) => Promise<string | null>
    checkPR: (runId: string) => Promise<AutomationRun | null>
    onRunStarted: (callback: (run: AutomationRun) => void) => Unsubscribe
    onRunCompleted: (callback: (run: AutomationRun) => void) => Unsubscribe
    onRunFailed: (callback: (run: AutomationRun) => void) => Unsubscribe
  }
  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
