import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getParentPath } from '../../utils/paths'
import { Dialog } from '../ui/Dialog'
import { btnSecondary, btnDanger } from '../ui/controls'

interface DeleteConfirmDialogProps {
  entry: FileSystemEntry
  projectId: string
  contextKey?: string
}

export function DeleteConfirmDialog({ entry, projectId, contextKey }: DeleteConfirmDialogProps) {
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
      const tabsToClose = Object.values(state.editorTabs).filter(
        (tab) =>
          tab.type !== 'browser' &&
          (tab.filePath === entry.path ||
            tab.filePath.startsWith(entry.path + '\\') ||
            tab.filePath.startsWith(entry.path + '/'))
      )
      for (const tab of tabsToClose) {
        state.closeEditorTab(tab.id)
      }

      // Clean up expandedPaths and directoryCache
      cleanupAfterDelete(contextKey ?? projectId, entry.path)

      clearDeletingEntry()
      await refreshDirectory(getParentPath(entry.path))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      setError(msg)
    }
  }

  return (
    <Dialog
      open
      onClose={clearDeletingEntry}
      title={`Delete ${isDirectory ? 'Folder' : 'File'}?`}
      icon={Trash2}
      size="sm"
      footer={
        <>
          <button ref={cancelRef} onClick={clearDeletingEntry} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={handleDelete} className={btnDanger}>
            Delete
          </button>
        </>
      }
    >
      <p className="text-[13px] text-fg-muted mb-1">
        <span className="font-medium text-fg-strong">{entry.name}</span>
      </p>
      <p className="text-[12px] text-fg-muted mb-4 break-all">{entry.path}</p>
      {isDirectory && (
        <p className="text-[13px] text-danger mb-4">
          This will permanently delete the folder and all its contents.
        </p>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
    </Dialog>
  )
}
