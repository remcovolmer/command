import { useEffect, useRef } from 'react'
import type { FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface DeleteConfirmDialogProps {
  entry: FileSystemEntry
  projectId: string
}

export function DeleteConfirmDialog({ entry, projectId }: DeleteConfirmDialogProps) {
  const api = getElectronAPI()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const clearDeletingEntry = useProjectStore((s) => s.clearDeletingEntry)
  const refreshDirectory = useProjectStore((s) => s.refreshDirectory)

  const isDirectory = entry.type === 'directory'

  // Focus cancel button on mount, Escape closes
  useEffect(() => {
    cancelRef.current?.focus()

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearDeletingEntry()
      }
      // Do NOT confirm on Enter (prevent accidental deletion)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [clearDeletingEntry])

  const getParentPath = (filePath: string) => {
    const sep = filePath.includes('\\') ? '\\' : '/'
    const parts = filePath.split(sep)
    parts.pop()
    return parts.join(sep)
  }

  const handleDelete = async () => {
    try {
      await api.fs.delete(entry.path)

      // Close any editor tabs for the deleted path
      const state = useProjectStore.getState()
      const tabsToClose = Object.values(state.editorTabs).filter((tab) =>
        tab.filePath === entry.path || tab.filePath.startsWith(entry.path + '\\') || tab.filePath.startsWith(entry.path + '/')
      )
      for (const tab of tabsToClose) {
        state.closeEditorTab(tab.id)
      }

      // Remove expandedPaths starting with deleted path
      const currentPaths = state.expandedPaths[projectId] ?? []
      const filteredPaths = currentPaths.filter(
        (p) => p !== entry.path && !p.startsWith(entry.path + '\\') && !p.startsWith(entry.path + '/')
      )
      if (filteredPaths.length !== currentPaths.length) {
        useProjectStore.setState((s) => ({
          expandedPaths: { ...s.expandedPaths, [projectId]: filteredPaths },
        }))
      }

      // Remove deleted path from directory cache
      useProjectStore.setState((s) => {
        const newCache = { ...s.directoryCache }
        delete newCache[entry.path]
        // Also remove any children caches
        for (const key of Object.keys(newCache)) {
          if (key.startsWith(entry.path + '\\') || key.startsWith(entry.path + '/')) {
            delete newCache[key]
          }
        }
        return { directoryCache: newCache }
      })

      clearDeletingEntry()
      await refreshDirectory(getParentPath(entry.path))
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md mx-4 shadow-xl">
        <h2 className="text-lg font-semibold text-card-foreground mb-2">
          Delete {isDirectory ? 'Folder' : 'File'}?
        </h2>
        <p className="text-sm text-muted-foreground mb-1">
          <span className="font-medium text-foreground">{entry.name}</span>
        </p>
        <p className="text-xs text-muted-foreground mb-4 break-all">
          {entry.path}
        </p>
        {isDirectory && (
          <p className="text-sm text-destructive mb-4">
            This will permanently delete the folder and all its contents.
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={clearDeletingEntry}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
