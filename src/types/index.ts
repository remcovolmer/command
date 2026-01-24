// Project types
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  sortOrder: number;
}

// Terminal types
export type TerminalState = 'starting' | 'running' | 'needs_input' | 'stopped' | 'error';

// Valid terminal states for runtime validation
export const VALID_TERMINAL_STATES: readonly TerminalState[] = ['starting', 'running', 'needs_input', 'stopped', 'error'] as const;

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
  };
  notification: {
    show: (title: string, body: string) => void;
  };
  app: {
    onCloseRequest: (callback: () => void) => Unsubscribe;
    confirmClose: () => void;
    cancelClose: () => void;
  };
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
