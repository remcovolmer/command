import { useState, useRef, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'

interface CommitFormProps {
  gitPath: string
  hasStagedFiles: boolean
  withOperation: (fn: () => Promise<void>) => Promise<boolean>
}

export function CommitForm({ gitPath, hasStagedFiles, withOperation }: CommitFormProps) {
  const api = getElectronAPI()
  const [message, setMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const commitInFlight = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canCommit = hasStagedFiles && message.trim().length > 0 && !isCommitting

  const handleCommit = useCallback(async () => {
    if (commitInFlight.current || !canCommit) return
    commitInFlight.current = true
    setIsCommitting(true)
    try {
      await withOperation(async () => {
        await api.git.commit(gitPath, message.trim())
        setMessage('')
      })
    } catch (err) {
      api.notification.show(
        'Commit Failed',
        err instanceof Error ? err.message : 'Failed to commit'
      )
    } finally {
      setIsCommitting(false)
      commitInFlight.current = false
    }
  }, [api, gitPath, message, canCommit, withOperation])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleCommit()
    }
  }, [handleCommit])

  // Auto-resize textarea whenever message changes (including clear after commit)
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const maxHeight = 6 * 20 // ~6 lines
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  }, [message])

  return (
    <div className="border-t border-border/50 px-3 py-2">
      <textarea
        ref={textareaRef}
        data-git-commit-input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message"
        disabled={isCommitting}
        rows={2}
        className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-muted-foreground">
          {hasStagedFiles ? '' : 'No staged files'}
        </span>
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className="px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          title="Commit staged changes (Ctrl+Enter)"
        >
          {isCommitting ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Committing...
            </>
          ) : (
            'Commit'
          )}
        </button>
      </div>
    </div>
  )
}
