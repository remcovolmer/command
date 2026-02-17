import { getElectronAPI } from './electron'
import type { FileWatchEvent, FileWatchError } from '../types'

type ChangeCallback = (events: FileWatchEvent[]) => void
type ErrorCallback = (error: FileWatchError) => void

/**
 * Centralized file watcher event manager.
 * Registers IPC listeners once and dispatches to per-project callbacks.
 * Follows the same pattern as terminalEvents.ts.
 */
class FileWatcherEventManager {
  private initialized = false
  private changeCallbacks = new Map<string, ChangeCallback>()
  private errorCallbacks = new Map<string, ErrorCallback>()
  private unsubChanges: (() => void) | null = null
  private unsubErrors: (() => void) | null = null

  init(): void {
    if (this.initialized) return
    this.initialized = true

    const api = getElectronAPI()

    this.unsubChanges = api.fs.onWatchChanges((events) => {
      // Group by projectId and dispatch to per-project callbacks
      const byProject = new Map<string, FileWatchEvent[]>()
      for (const event of events) {
        const arr = byProject.get(event.projectId) ?? []
        arr.push(event)
        byProject.set(event.projectId, arr)
      }
      for (const [projectId, projectEvents] of byProject) {
        this.changeCallbacks.get(projectId)?.(projectEvents)
      }
    })

    this.unsubErrors = api.fs.onWatchError((error) => {
      this.errorCallbacks.get(error.projectId)?.(error)
    })
  }

  subscribe(projectId: string, callback: ChangeCallback): void {
    this.init()
    this.changeCallbacks.set(projectId, callback)
  }

  unsubscribe(projectId: string): void {
    this.changeCallbacks.delete(projectId)
    this.errorCallbacks.delete(projectId)
  }

  subscribeError(projectId: string, callback: ErrorCallback): void {
    this.init()
    this.errorCallbacks.set(projectId, callback)
  }

  unsubscribeError(projectId: string): void {
    this.errorCallbacks.delete(projectId)
  }

  dispose(): void {
    this.unsubChanges?.()
    this.unsubErrors?.()
    this.changeCallbacks.clear()
    this.errorCallbacks.clear()
    this.unsubChanges = null
    this.unsubErrors = null
    this.initialized = false
  }
}

export const fileWatcherEvents = new FileWatcherEventManager()
