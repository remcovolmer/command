// Project types
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  sortOrder: number;
}

// Worktree types
export interface Worktree {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  createdAt: number;
  isLocked: boolean;
}

// Terminal types - Claude Code states (5 states)
export type TerminalState =
  | 'busy'        // Blue - Claude is working (includes starting)
  | 'permission'  // Orange - Claude needs permission for tool/command
  | 'question'    // Orange - Claude asked a question via AskUserQuestion
  | 'done'        // Green - Claude finished, waiting for new prompt
  | 'stopped';    // Red - Terminal stopped or error

// Terminal type: 'claude' runs Claude Code, 'normal' is a plain shell
export type TerminalType = 'claude' | 'normal';

// Valid terminal states for runtime validation
export const VALID_TERMINAL_STATES: readonly TerminalState[] = [
  'busy', 'permission', 'question', 'done', 'stopped'
] as const;

// Type guard for terminal state
export function isValidTerminalState(state: string): state is TerminalState {
  return VALID_TERMINAL_STATES.includes(state as TerminalState);
}

// Unsubscribe function type for IPC listeners
export type Unsubscribe = () => void;

export interface TerminalSession {
  id: string;
  projectId: string;
  worktreeId: string | null;  // null = direct in project, string = in worktree
  state: TerminalState;
  lastActivity: number;
  title: string;
  type: TerminalType;  // 'claude' or 'normal' shell
}

// Editor tab types
export interface EditorTab {
  id: string;
  type: 'editor';
  filePath: string;
  fileName: string;
  isDirty: boolean;
  projectId: string;
}

// File system types
export interface FileSystemEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
}

// Git types
export interface GitFileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
}

export interface GitBranchInfo {
  name: string;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: GitBranchInfo | null;
  staged: GitFileChange[];
  modified: GitFileChange[];
  untracked: GitFileChange[];
  conflicted: GitFileChange[];
  isClean: boolean;
  error?: string;
}

// GitHub PR types
export interface PRCheckStatus {
  name: string;
  state: string;
  bucket: string;
}

export interface PRStatus {
  noPR: boolean;
  number?: number;
  title?: string;
  url?: string;
  state?: 'OPEN' | 'CLOSED' | 'MERGED';
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus?: 'CLEAN' | 'DIRTY' | 'BLOCKED' | 'UNSTABLE' | 'UNKNOWN';
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  statusCheckRollup?: PRCheckStatus[];
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  loading?: boolean;
  error?: string;
  lastUpdated?: number;
}

// Update types
export interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  currentVersion?: string;
  isDev?: boolean;
}

export interface UpdateAvailableInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
}

export interface UpdateProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateDownloadedInfo {
  version: string;
}

export interface UpdateErrorInfo {
  message: string;
}

// Layout types
export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalLayout {
  projectId: string;
  // Terminal IDs currently shown in split view (2-3 terminals side by side)
  // Empty array or single item = no split, just tabs
  splitTerminalIds: string[];
  // Percentages for each split pane (should match splitTerminalIds length)
  splitSizes: number[];
}

// App state
export interface AppState {
  projects: Project[];
  terminals: Record<string, TerminalSession>;
  layouts: Record<string, TerminalLayout>;
  activeProjectId: string | null;
  activeTerminalId: string | null;
}

// IPC API types
export interface ElectronAPI {
  terminal: {
    create: (projectId: string, worktreeId?: string, type?: TerminalType) => Promise<string>;
    write: (terminalId: string, data: string) => void;
    resize: (terminalId: string, cols: number, rows: number) => void;
    close: (terminalId: string) => void;
    onData: (callback: (id: string, data: string) => void) => Unsubscribe;
    onStateChange: (callback: (id: string, state: TerminalState) => void) => Unsubscribe;
    onExit: (callback: (id: string, code: number) => void) => Unsubscribe;
    onTitleChange: (callback: (id: string, title: string) => void) => Unsubscribe;
  };
  project: {
    list: () => Promise<Project[]>;
    add: (path: string, name?: string) => Promise<Project>;
    remove: (id: string) => Promise<void>;
    selectFolder: () => Promise<string | null>;
    reorder: (projectIds: string[]) => Promise<Project[]>;
  };
  worktree: {
    create: (projectId: string, branchName: string, worktreeName?: string) => Promise<Worktree>;
    list: (projectId: string) => Promise<Worktree[]>;
    listBranches: (projectId: string) => Promise<{ local: string[]; remote: string[]; current: string | null }>;
    remove: (worktreeId: string, force?: boolean) => Promise<void>;
    hasChanges: (worktreeId: string) => Promise<boolean>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
    openInEditor: (path: string) => Promise<void>;
  };
  notification: {
    show: (title: string, body: string) => void;
  };
  app: {
    onCloseRequest: (callback: () => void) => Unsubscribe;
    confirmClose: () => void;
    cancelClose: () => void;
  };
  fs: {
    readDirectory: (dirPath: string) => Promise<FileSystemEntry[]>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<void>;
  };
  git: {
    getStatus: (projectPath: string) => Promise<GitStatus>;
    fetch: (projectPath: string) => Promise<string>;
    pull: (projectPath: string) => Promise<string>;
    push: (projectPath: string) => Promise<string>;
  };
  github: {
    checkAvailable: () => Promise<{ installed: boolean; authenticated: boolean }>;
    getPRStatus: (projectPath: string) => Promise<PRStatus>;
    mergePR: (projectPath: string, prNumber: number) => Promise<void>;
    startPolling: (key: string, projectPath: string) => Promise<void>;
    stopPolling: (key: string) => Promise<void>;
    onPRStatusUpdate: (callback: (key: string, status: PRStatus) => void) => Unsubscribe;
  };
  update: {
    check: () => Promise<UpdateCheckResult>;
    download: () => Promise<{ success: boolean; isDev?: boolean }>;
    install: () => Promise<void>;
    getVersion: () => Promise<string>;
    onChecking: (callback: () => void) => Unsubscribe;
    onAvailable: (callback: (info: UpdateAvailableInfo) => void) => Unsubscribe;
    onNotAvailable: (callback: () => void) => Unsubscribe;
    onProgress: (callback: (progress: UpdateProgressInfo) => void) => Unsubscribe;
    onDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => Unsubscribe;
    onError: (callback: (error: UpdateErrorInfo) => void) => Unsubscribe;
  };
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
