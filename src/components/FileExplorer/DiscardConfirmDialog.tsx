import { useRef, useEffect, useState, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface DiscardConfirmDialogProps {
  gitPath: string
  onComplete?: () => void
}

export function DiscardConfirmDialog({ gitPath, onComplete }: DiscardConfirmDialogProps) {
  const discardingFiles = useProjectStore((s) => s.discardingFiles)
  const clearDiscardingFiles = useProjectStore((s) => s.clearDiscardingFiles)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const api = getElectronAPI()

  useEffect(() => {
    if (discardingFiles) {
      cancelRef.current?.focus()
      setError(null)
      setLoading(false)
    }
  }, [discardingFiles])

  useEffect(() => {
    if (!discardingFiles) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        clearDiscardingFiles()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [discardingFiles, clearDiscardingFiles, loading])

  const handleConfirm = useCallback(async () => {
    if (!discardingFiles || loading) return
    setLoading(true)
    setError(null)
    try {
      if (discardingFiles.isUntracked) {
        await api.git.deleteUntrackedFiles(gitPath, discardingFiles.files)
      } else {
        await api.git.discardFiles(gitPath, discardingFiles.files)
      }
      clearDiscardingFiles()
      onComplete?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discard failed')
    } finally {
      setLoading(false)
    }
  }, [api, gitPath, discardingFiles, clearDiscardingFiles, onComplete, loading])

  if (!discardingFiles) return null

  const { files, isUntracked } = discardingFiles
  const isSingle = files.length === 1
  const fileName = isSingle ? (files[0].split(/[/\\]/).pop() || files[0]) : ''

  let title: string
  let description: string
  if (isUntracked) {
    title = isSingle ? 'Delete untracked file?' : `Delete ${files.length} untracked files?`
    description = isSingle
      ? `Delete "${fileName}"? This cannot be undone.`
      : `Delete ${files.length} untracked files? This cannot be undone.`
  } else {
    title = isSingle ? 'Discard changes?' : `Discard changes to ${files.length} files?`
    description = isSingle
      ? `Discard changes to "${fileName}"? This cannot be undone.`
      : `Discard changes to ${files.length} files? This cannot be undone.`
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md mx-4 shadow-xl">
        <h3 className="text-base font-semibold text-card-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4">{description}</p>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={clearDiscardingFiles}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Working…' : isUntracked ? 'Delete' : 'Discard'}
          </button>
        </div>
      </div>
    </div>
  )
}
