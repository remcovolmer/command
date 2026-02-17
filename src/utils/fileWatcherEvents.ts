import { getElectronAPI } from './electron'
import type { FileWatchEvent, FileWatchError } from '../types'

type ChangeCallback = (events: FileWatchEvent[]) => void
type ErrorCallback = (error: FileWatchError) => void

/**
 * Centralized file watcher event manager.
 * Registers IPC listeners once and dispatches to per-project callbacks.
 * Supports multiple subscribers per project via unique subscriber keys.
 * Follows the same pattern as terminalEvents.ts.
 */
class FileWatcherEventManager {
  private initialized = false
  // Key: `${projectId}:${subscriberKey}` -> callback
  private changeCallbacks = new Map<string, ChangeCallback>()
  private errorCallbacks = new Map<string, ErrorCallback>()
  private unsubChanges: (() => void) | null = null
  private unsubErrors: (() => void) | null = null

  init(): void {
    if (this.initialized) return
    this.initialized = true

    const api = getElectronAPI()

    this.unsubChanges = api.fs.onWatchChanges((events) => {
      // Group by projectId and dispatch to all subscribers for that project
      const byProject = new Map<string, FileWatchEvent[]>()
      for (const event of events) {
        const arr = byProject.get(event.projectId) ?? []
        arr.push(event)
        byProject.set(event.projectId, arr)
      }
      for (const [projectId, projectEvents] of byProject) {
        for (const [key, callback] of this.changeCallbacks) {
          if (key.startsWith(projectId + ':')) {
            callback(projectEvents)
          }
        }
      }
    })

    this.unsubErrors = api.fs.onWatchError((error) => {
      for (const [key, callback] of this.errorCallbacks) {
        if (key.startsWith(error.projectId + ':')) {
          callback(error)
        }
      }
    })
  }

  /**
   * Subscribe to file change events for a project.
   * @param projectId The project to subscribe to
   * @param subscriberKey Unique key for this subscriber (e.g., 'file-tree', 'git-status')
   * @param callback Called with batched events for this project
   */
  subscribe(projectId: string, subscriberKey: string, callback: ChangeCallback): void {
    this.init()
    this.changeCallbacks.set(`${projectId}:${subscriberKey}`, callback)
  }

  /**
   * Unsubscribe a specific subscriber from a project.
   */
  unsubscribe(projectId: string, subscriberKey: string): void {
    this.changeCallbacks.delete(`${projectId}:${subscriberKey}`)
    this.errorCallbacks.delete(`${projectId}:${subscriberKey}`)
  }

  subscribeError(projectId: string, subscriberKey: string, callback: ErrorCallback): void {
    this.init()
    this.errorCallbacks.set(`${projectId}:${subscriberKey}`, callback)
  }

  unsubscribeError(projectId: string, subscriberKey: string): void {
    this.errorCallbacks.delete(`${projectId}:${subscriberKey}`)
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
