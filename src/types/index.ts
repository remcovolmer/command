// Project types
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  sortOrder: number;
}

// Terminal types - Claude Code specific states
export type TerminalState =
  | 'starting'    // Terminal starting up
  | 'busy'        // Claude is working (spinner/activity detected)
  | 'question'    // Claude asking a question
  | 'permission'  // Claude needs permission for tool/command
  | 'ready'       // Claude waiting for user input
  | 'stopped'     // Terminal stopped
  | 'error';      // Error occurred

// Valid terminal states for runtime validation
export const VALID_TERMINAL_STATES: readonly TerminalState[] = [
  'starting', 'busy', 'question', 'permission', 'ready', 'stopped', 'error'
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
  state: TerminalState;
  lastActivity: number;
  title: string;
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
    create: (projectId: string) => Promise<string>;
    write: (terminalId: string, data: string) => void;
    resize: (terminalId: string, cols: number, rows: number) => void;
    close: (terminalId: string) => void;
    onData: (callback: (id: string, data: string) => void) => Unsubscribe;
    onStateChange: (callback: (id: string, state: TerminalState) => void) => Unsubscribe;
    onExit: (callback: (id: string, code: number) => void) => Unsubscribe;
  };
  project: {
    list: () => Promise<Project[]>;
    add: (path: string, name?: string) => Promise<Project>;
    remove: (id: string) => Promise<void>;
    selectFolder: () => Promise<string | null>;
    reorder: (projectIds: string[]) => Promise<Project[]>;
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
  };
  git: {
    getStatus: (projectPath: string) => Promise<GitStatus>;
  };
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
