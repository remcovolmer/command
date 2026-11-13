import { getElectronAPI } from './electron'
import { terminalPool, type TerminalPool } from './terminalPool'
import { useProjectStore } from '../stores/projectStore'
import {
  isValidTerminalState,
  type TerminalState,
  type TerminalSession,
  type Unsubscribe,
  type RestoredSession,
  type SpawnFailedEvent,
} from '../types'

type DataCallback = (data: string) => void
type ExitCallback = (code: number) => void
type TitleCallback = (title: string) => void
type WorktreeUpdatedCallback = (worktreeId: string) => void
type SummaryCallback = (summary: string) => void
type SummaryUpdateCallback = (terminalId: string, summary: string) => void
type GeneratedTitleUpdateCallback = (terminalId: string, title: string) => void
type SessionRestoredCallback = (session: RestoredSession) => void
type SidecarCreatedCallback = (contextKey: string, terminal: TerminalSession) => void
type StatusMessageCallback = (terminalId: string, message: string) => void
type EditorOpenFileCallback = (data: {
  filePath: string
  fileName: string
  projectId: string
  line?: number
  terminalId?: string
}) => void
type EditorOpenBrowserCallback = (data: {
  url: string
  projectId: string
  terminalId?: string
}) => void
type SpawnFailedCallback = (event: SpawnFailedEvent) => void

/** Store writes that must happen for every terminal, xterm or not. */
export interface TerminalEventSink {
  hasTerminal: (terminalId: string) => boolean
  updateTerminalState: (terminalId: string, state: TerminalState) => void
  updateTerminalTitle: (terminalId: string, title: string) => void
}

export interface TerminalEventDeps {
  getApi: () => typeof window.electronAPI
  sink: TerminalEventSink
  pool: Pick<TerminalPool, 'appendPendingData'>
}

const storeSink: TerminalEventSink = {
  hasTerminal: (id) => Boolean(useProjectStore.getState().terminals[id]),
  updateTerminalState: (id, state) => useProjectStore.getState().updateTerminalState(id, state),
  updateTerminalTitle: (id, title) => useProjectStore.getState().updateTerminalTitle(id, title),
}

/**
 * Centralized terminal event manager.
 * Registers IPC listeners once and dispatches to per-terminal callbacks.
 * This prevents memory leaks from registering multiple IPC listeners.
 *
 * State and title updates go to the store for EVERY terminal, independent of
 * whether an xterm is subscribed (restored-but-never-opened and evicted chats
 * must still show permission/question/done). Data for a known terminal with no
 * live xterm is parked in the pool and replayed when the xterm (re)opens.
 */
export class TerminalEventManager {
  private dataCallbacks = new Map<string, DataCallback>()
  private exitCallbacks = new Map<string, ExitCallback>()
  private titleCallbacks = new Map<string, TitleCallback>()
  private worktreeUpdatedCallbacks = new Map<string, WorktreeUpdatedCallback>()
  private summaryCallbacks = new Map<string, SummaryCallback>()
  private summaryUpdateCallbacks: SummaryUpdateCallback[] = []
  private generatedTitleUpdateCallbacks: GeneratedTitleUpdateCallback[] = []
  private sessionRestoredCallbacks: SessionRestoredCallback[] = []
  private sidecarCreatedCallbacks: SidecarCreatedCallback[] = []
  private statusMessageCallbacks: StatusMessageCallback[] = []
  private editorOpenFileCallbacks: EditorOpenFileCallback[] = []
  private editorOpenBrowserCallbacks: EditorOpenBrowserCallback[] = []
  private spawnFailedCallbacks: SpawnFailedCallback[] = []
  private initialized = false
  private unsubscribers: Unsubscribe[] = []
  private deps: TerminalEventDeps

  constructor(deps: Partial<TerminalEventDeps> = {}) {
    this.deps = {
      getApi: deps.getApi ?? getElectronAPI,
      sink: deps.sink ?? storeSink,
      pool: deps.pool ?? terminalPool,
    }
  }

  init() {
    if (this.initialized) return
    this.initialized = true

    const api = this.deps.getApi()
    const { sink, pool } = this.deps

    // Store unsubscribe functions for cleanup
    this.unsubscribers.push(
      api.terminal.onData((terminalId, data) => {
        const callback = this.dataCallbacks.get(terminalId)
        if (callback) {
          callback(data)
        } else if (sink.hasTerminal(terminalId)) {
          // No live xterm (evicted — possibly still in flight before main
          // processed terminal:evict — or never opened): keep it for replay.
          pool.appendPendingData(terminalId, data)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onStateChange((terminalId, state) => {
        // Validate state before dispatching (#004 fix)
        if (isValidTerminalState(state)) {
          sink.updateTerminalState(terminalId, state)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onExit((terminalId, code) => {
        const callback = this.exitCallbacks.get(terminalId)
        if (callback) callback(code)
      })
    )

    this.unsubscribers.push(
      api.terminal.onTitleChange((terminalId, title) => {
        const callback = this.titleCallbacks.get(terminalId)
        if (callback) callback(title)
        else sink.updateTerminalTitle(terminalId, title)
      })
    )

    this.unsubscribers.push(
      api.terminal.onWorktreeUpdated((terminalId, worktreeId) => {
        const callback = this.worktreeUpdatedCallbacks.get(terminalId)
        if (callback) callback(worktreeId)
      })
    )

    this.unsubscribers.push(
      api.terminal.onSummaryChange((terminalId, summary) => {
        const callback = this.summaryCallbacks.get(terminalId)
        if (callback) callback(summary)
        // Also notify global listeners (used by Sidebar to update store)
        for (const cb of this.summaryUpdateCallbacks) {
          cb(terminalId, summary)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onGeneratedTitleChange((terminalId, title) => {
        for (const cb of this.generatedTitleUpdateCallbacks) {
          cb(terminalId, title)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onSessionRestored((session) => {
        for (const callback of this.sessionRestoredCallbacks) {
          callback(session)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onSidecarCreated((contextKey, terminal) => {
        for (const callback of this.sidecarCreatedCallbacks) {
          callback(contextKey, terminal)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onStatusMessage((terminalId, message) => {
        for (const callback of this.statusMessageCallbacks) {
          callback(terminalId, message)
        }
      })
    )

    this.unsubscribers.push(
      api.editor.onOpenFile((data) => {
        for (const callback of this.editorOpenFileCallbacks) {
          callback(data)
        }
      })
    )

    this.unsubscribers.push(
      api.editor.onOpenBrowser((data) => {
        for (const callback of this.editorOpenBrowserCallbacks) {
          callback(data)
        }
      })
    )

    this.unsubscribers.push(
      api.terminal.onSpawnFailed((event) => {
        for (const callback of this.spawnFailedCallbacks) {
          callback(event)
        }
      })
    )
  }

  /**
   * Attach a live xterm. `onTitle` overrides the default store title update;
   * state always goes to the store globally (see init()).
   */
  subscribe(
    terminalId: string,
    onData: DataCallback,
    onExit?: ExitCallback,
    onTitle?: TitleCallback,
    onWorktreeUpdated?: WorktreeUpdatedCallback,
    onSummary?: SummaryCallback
  ) {
    this.init()
    this.dataCallbacks.set(terminalId, onData)
    if (onExit) this.exitCallbacks.set(terminalId, onExit)
    if (onTitle) this.titleCallbacks.set(terminalId, onTitle)
    if (onWorktreeUpdated) this.worktreeUpdatedCallbacks.set(terminalId, onWorktreeUpdated)
    if (onSummary) this.summaryCallbacks.set(terminalId, onSummary)
  }

  unsubscribe(terminalId: string) {
    this.dataCallbacks.delete(terminalId)
    this.exitCallbacks.delete(terminalId)
    this.titleCallbacks.delete(terminalId)
    this.worktreeUpdatedCallbacks.delete(terminalId)
    this.summaryCallbacks.delete(terminalId)
  }

  /**
   * Subscribe to summary update events (for updating store when summaries arrive)
   */
  onSummaryUpdate(callback: SummaryUpdateCallback): () => void {
    this.init()
    this.summaryUpdateCallbacks.push(callback)
    return () => {
      const index = this.summaryUpdateCallbacks.indexOf(callback)
      if (index !== -1) this.summaryUpdateCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to generated title update events (for updating store when hook-generated titles arrive)
   */
  onGeneratedTitleUpdate(callback: GeneratedTitleUpdateCallback): () => void {
    this.init()
    this.generatedTitleUpdateCallbacks.push(callback)
    return () => {
      const index = this.generatedTitleUpdateCallbacks.indexOf(callback)
      if (index !== -1) this.generatedTitleUpdateCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to session restored events (for adding restored terminals to store)
   */
  onSessionRestored(callback: SessionRestoredCallback): () => void {
    this.init()
    this.sessionRestoredCallbacks.push(callback)
    return () => {
      const index = this.sessionRestoredCallbacks.indexOf(callback)
      if (index !== -1) this.sessionRestoredCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to sidecar created events (for registering server-created sidecars in store)
   */
  onSidecarCreated(callback: SidecarCreatedCallback): () => void {
    this.init()
    this.sidecarCreatedCallbacks.push(callback)
    return () => {
      const index = this.sidecarCreatedCallbacks.indexOf(callback)
      if (index !== -1) this.sidecarCreatedCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to terminal status message events (from CommandServer /status route)
   */
  onStatusMessage(callback: StatusMessageCallback): () => void {
    this.init()
    this.statusMessageCallbacks.push(callback)
    return () => {
      const index = this.statusMessageCallbacks.indexOf(callback)
      if (index !== -1) this.statusMessageCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to editor open file events (from CommandServer /open route)
   */
  onEditorOpenFile(callback: EditorOpenFileCallback): () => void {
    this.init()
    this.editorOpenFileCallbacks.push(callback)
    return () => {
      const index = this.editorOpenFileCallbacks.indexOf(callback)
      if (index !== -1) this.editorOpenFileCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to editor open browser events (from CommandServer /open route,
   * URL targets). Renders a URL in a built-in browser tab.
   */
  onEditorOpenBrowser(callback: EditorOpenBrowserCallback): () => void {
    this.init()
    this.editorOpenBrowserCallbacks.push(callback)
    return () => {
      const index = this.editorOpenBrowserCallbacks.indexOf(callback)
      if (index !== -1) this.editorOpenBrowserCallbacks.splice(index, 1)
    }
  }

  /**
   * Subscribe to terminal spawn-failed events (surfaced as toast notifications).
   * Routed through the manager so the IPC listener is registered once globally
   * instead of per-component, mirroring the pattern used for session-restored.
   */
  onSpawnFailed(callback: SpawnFailedCallback): () => void {
    this.init()
    this.spawnFailedCallbacks.push(callback)
    return () => {
      const index = this.spawnFailedCallbacks.indexOf(callback)
      if (index !== -1) this.spawnFailedCallbacks.splice(index, 1)
    }
  }

  /**
   * Cleanup all IPC listeners. Call when app is shutting down.
   */
  dispose() {
    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
    this.dataCallbacks.clear()
    this.exitCallbacks.clear()
    this.titleCallbacks.clear()
    this.worktreeUpdatedCallbacks.clear()
    this.summaryCallbacks.clear()
    this.summaryUpdateCallbacks = []
    this.generatedTitleUpdateCallbacks = []
    this.sessionRestoredCallbacks = []
    this.sidecarCreatedCallbacks = []
    this.statusMessageCallbacks = []
    this.editorOpenFileCallbacks = []
    this.editorOpenBrowserCallbacks = []
    this.spawnFailedCallbacks = []
    this.initialized = false
  }
}

export const terminalEvents = new TerminalEventManager()
