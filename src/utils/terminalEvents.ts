import { getElectronAPI } from './electron'
import { isValidTerminalState, type TerminalState, type Unsubscribe, type RestoredSession } from '../types'

type DataCallback = (data: string) => void
type StateCallback = (state: TerminalState) => void
type ExitCallback = (code: number) => void
type TitleCallback = (title: string) => void
type SessionRestoredCallback = (session: RestoredSession) => void

/**
 * Centralized terminal event manager.
 * Registers IPC listeners once and dispatches to per-terminal callbacks.
 * This prevents memory leaks from registering multiple IPC listeners.
 */
class TerminalEventManager {
  private dataCallbacks = new Map<string, DataCallback>()
  private stateCallbacks = new Map<string, StateCallback>()
  private exitCallbacks = new Map<string, ExitCallback>()
  private titleCallbacks = new Map<string, TitleCallback>()
  private sessionRestoredCallbacks: SessionRestoredCallback[] = []
  private initialized = false
  private unsubscribers: Unsubscribe[] = []

  init() {
    if (this.initialized) return
    this.initialized = true

    const api = getElectronAPI()

    // Store unsubscribe functions for cleanup
    this.unsubscribers.push(
      api.terminal.onData((terminalId, data) => {
        const callback = this.dataCallbacks.get(terminalId)
        if (callback) callback(data)
      })
    )

    this.unsubscribers.push(
      api.terminal.onStateChange((terminalId, state) => {
        // Validate state before dispatching (#004 fix)
        if (isValidTerminalState(state)) {
          const callback = this.stateCallbacks.get(terminalId)
          if (callback) callback(state)
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
      })
    )

    this.unsubscribers.push(
      api.terminal.onSessionRestored((session) => {
        for (const callback of this.sessionRestoredCallbacks) {
          callback(session)
        }
      })
    )
  }

  subscribe(
    terminalId: string,
    onData: DataCallback,
    onState: StateCallback,
    onExit?: ExitCallback,
    onTitle?: TitleCallback
  ) {
    this.init()
    this.dataCallbacks.set(terminalId, onData)
    this.stateCallbacks.set(terminalId, onState)
    if (onExit) this.exitCallbacks.set(terminalId, onExit)
    if (onTitle) this.titleCallbacks.set(terminalId, onTitle)
  }

  unsubscribe(terminalId: string) {
    this.dataCallbacks.delete(terminalId)
    this.stateCallbacks.delete(terminalId)
    this.exitCallbacks.delete(terminalId)
    this.titleCallbacks.delete(terminalId)
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
   * Cleanup all IPC listeners. Call when app is shutting down.
   */
  dispose() {
    this.unsubscribers.forEach(unsub => unsub())
    this.unsubscribers = []
    this.dataCallbacks.clear()
    this.stateCallbacks.clear()
    this.exitCallbacks.clear()
    this.titleCallbacks.clear()
    this.sessionRestoredCallbacks = []
    this.initialized = false
  }
}

export const terminalEvents = new TerminalEventManager()
