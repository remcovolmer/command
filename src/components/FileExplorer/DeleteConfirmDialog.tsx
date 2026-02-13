import { useEffect, useRef, useState } from 'react'
import type { FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getParentPath } from '../../utils/paths'

interface DeleteConfirmDialogProps {
  entry: FileSystemEntry
  projectId: string
}

export function DeleteConfirmDialog({ entry, projectId }: DeleteConfirmDialogProps) {
  const api = getElectronAPI()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const clearDeletingEntry = useProjectStore((s) => s.clearDeletingEntry)
  const refreshDirectory = useProjectStore((s) => s.refreshDirectory)
  const cleanupAfterDelete = useProjectStore((s) => s.cleanupAfterDelete)
  const [error, setError] = useState<string | null>(null)

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

      // Clean up expandedPaths and directoryCache
      cleanupAfterDelete(projectId, entry.path)

      clearDeletingEntry()
      await refreshDirectory(getParentPath(entry.path))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      setError(msg)
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
        {error && (
          <p className="text-sm text-destructive mb-4">{error}</p>
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
