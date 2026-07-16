/**
 * Shared IPC contract types — the single source of truth for every type that
 * crosses the Electron process boundary (renderer ↔ preload ↔ main).
 *
 * RULE: this module is type-only. No consts, no functions, no enums — nothing
 * with a runtime representation. It is imported with `import type` by the
 * preload bundle, the renderer and the main process; type-only imports are
 * fully erased by the bundler, which keeps Electron process isolation and the
 * cjs preload bundle intact. Runtime helpers (type guards, const arrays)
 * belong in `src/types` or the owning process — never here.
 */

// Project types
export type ProjectType = 'project' | 'code'

export type AuthMode = 'subscription' | 'profile'

export type ClaudeMode = 'chat' | 'auto' | 'full-auto'

export interface AccountProfile {
  id: string
  name: string
  envVarCount: number // renderer sees count only, never the values
}

export interface ProjectSettings {
  claudeMode?: ClaudeMode
  authMode?: AuthMode
  profileId?: string
  defaultAgent?: AgentType // agent used for new chats in this project (default: 'claude')
}

export interface Project {
  id: string
  name: string
  path: string
  type: ProjectType
  createdAt: number
  sortOrder: number
  pinned?: boolean
  settings?: ProjectSettings
}

// Worktree types
export interface Worktree {
  id: string
  projectId: string
  name: string
  branch: string
  path: string
  createdAt: number
  isLocked: boolean
}

export interface BranchList {
  local: string[]
  remote: string[]
  current: string | null
}

// Terminal types - Claude Code states (5 states)
export type TerminalState =
  | 'busy' // Gray - Claude is working (includes starting)
  | 'permission' // Orange - Claude needs permission for tool/command
  | 'question' // Orange - Claude asked a question via AskUserQuestion
  | 'done' // Green - Claude finished, waiting for new prompt
  | 'stopped' // Red - Terminal stopped or error

// Coding agents Command can drive as a chat session. Each is a CLI wrapped in a
// PTY. Display metadata lives in shared/agents.ts; spawn spec (binary, resume,
// mode flags, hook capability) in electron/main/services/agents.ts.
export type AgentType = 'claude' | 'codex' | 'pi'

// Terminal type: an agent chat ('claude' | 'codex' | 'pi') or a plain shell ('normal').
export type TerminalType = AgentType | 'normal'

// Unsubscribe function type for IPC listeners
export type Unsubscribe = () => void

export interface TerminalSession {
  id: string
  projectId: string
  worktreeId: string | null // null = direct in project, string = in worktree
  state: TerminalState
  lastActivity: number
  title: string
  type: TerminalType // agent chat ('claude' | 'codex' | 'pi') or 'normal' shell
  summary?: string // Session summary from Claude Code's sessions-index.json
  generatedTitle?: string // LLM-generated title from Ollama via session-summary-hook
  origin?: 'automation' // set when spawned by an automation launch (drives the spawn cue)
}

/** Session metadata extracted from Claude Code JSONL transcripts. */
export interface SessionIndexEntry {
  sessionId: string
  summary: string
  firstPrompt: string
  messageCount: number
  gitBranch: string
  modified: string
  created: string
  projectPath: string
  isSidechain: boolean
  filesModified: string[]
  filesRead: string[]
  toolCounts: Record<string, number>
  errorCount: number
  durationMs: number
  assistantMessageCount: number
  generatedTitle?: string // LLM-generated title from Ollama
  generatedSummary?: string // LLM-generated summary from Ollama
  worktreeName?: string // Name of worktree this session was started in (undefined for root-cwd)
}

// File system types
export interface FileSystemEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
}

// Git types
export interface GitFileChange {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
  staged: boolean
}

export interface GitBranchInfo {
  name: string
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitStatus {
  isGitRepo: boolean
  branch: GitBranchInfo | null
  staged: GitFileChange[]
  modified: GitFileChange[]
  untracked: GitFileChange[]
  conflicted: GitFileChange[]
  isClean: boolean
  error?: string
}

// Git commit types
export interface GitCommit {
  hash: string
  shortHash: string
  message: string // first line only
  authorName: string
  authorDate: string // ISO 8601
  parentHashes: string[]
}

export interface GitCommitFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  oldPath?: string
}

export interface GitCommitDetail {
  hash: string
  fullMessage: string
  authorName: string
  authorEmail: string
  authorDate: string
  files: GitCommitFile[]
  isMerge: boolean
  parentHashes: string[]
}

export interface GitCommitLog {
  commits: GitCommit[]
  hasMore: boolean
}

export interface GitBranchListItem {
  name: string
  current: boolean
  upstream: string | null
}

// GitHub PR types
export interface PRCheckStatus {
  name: string
  state: string
  bucket: string
}

export interface PRStatus {
  noPR: boolean
  number?: number
  title?: string
  url?: string
  headRefName?: string
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
  // True when the most recent refresh failed transiently. The rest of the
  // fields hold the last known-good values so the UI can keep showing them.
  stale?: boolean
}

// Plan-usage types (pushed by UsageService via usage:update)
export interface UsageWindow {
  utilization: number
  resetsAt: string
}

export interface UsageData {
  status: 'ok' | 'unavailable'
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
  sevenDaySonnet?: UsageWindow
  extraUsage?: {
    usedCredits: number
    currency: string
  }
}

// Task types
export interface TaskItem {
  id: string // Generated: `${filePath}:${lineNumber}`
  text: string // Full task text (without checkbox syntax)
  completed: boolean // true = [x], false = [ ]
  section: string // Section name (e.g., "Now", "Next", custom)
  filePath: string // Source TASKS.md file path
  lineNumber: number // Line number in source file
  dueDate?: string // Parsed from 📅 YYYY-MM-DD
  personTags?: string[] // Parsed from [[Name]] syntax
  isOverdue?: boolean // Computed: dueDate < today
  isDueToday?: boolean // Computed: dueDate === today
}

export interface TaskSection {
  name: string // Section heading text
  priority: number // Sort order (Now=0, Next=1, Waiting=2, Later=3, Done=4, custom=5+)
  tasks: TaskItem[]
}

export interface TasksData {
  sections: TaskSection[]
  files: string[] // All discovered TASKS.md file paths
  totalOpen: number // Count of uncompleted tasks
  nowCount: number // Count of tasks in "Now" section (for badge)
}

export interface TaskUpdate {
  filePath: string
  lineNumber: number
  action: 'toggle' | 'edit' | 'delete'
  newText?: string // For 'edit' action
}

export interface TaskMove {
  filePath: string
  lineNumber: number
  targetSection: string // Section name to move to
}

export interface TaskAdd {
  filePath: string // Which TASKS.md to add to
  section: string // Which section
  text: string // Task text
}

// Update types
export interface UpdateCheckResult {
  updateAvailable: boolean
  version?: string
  currentVersion?: string
  isDev?: boolean
}

export interface UpdateAvailableInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string | null
}

export interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateDownloadedInfo {
  version: string
}

export interface UpdateErrorInfo {
  message: string
}

// IPC event payloads
export interface RestoredSession {
  terminalId: string
  agentType?: AgentType // which agent this restored chat runs (absent → 'claude')
  projectId: string
  worktreeId: string | null
  title: string
  summary?: string
}

export type SpawnFailureCode = 'CWD_MISSING' | 'CWD_NOT_DIR' | 'SPAWN_FAILED'

export interface SpawnFailedEvent {
  projectId?: string
  worktreeId?: string
  code: SpawnFailureCode
  cwd: string
  message: string
}

export interface UncaughtErrorEvent {
  source: 'uncaughtException' | 'unhandledRejection'
  message: string
  logPath: string
}
