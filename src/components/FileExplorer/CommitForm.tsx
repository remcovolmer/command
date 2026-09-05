import { useState, useRef, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import { btnPrimary, textarea as textareaClass } from '../ui/controls'

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleCommit()
      }
    },
    [handleCommit]
  )

  // Auto-resize textarea whenever message changes (including clear after commit)
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const maxHeight = 6 * 20 // ~6 lines
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
  }, [message])

  return (
    <div className="border-t border-border px-3 py-2">
      <textarea
        ref={textareaRef}
        data-git-commit-input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message"
        disabled={isCommitting}
        rows={2}
        className={`w-full ${textareaClass} resize-none disabled:opacity-50`}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-fg-muted">
          {hasStagedFiles ? '' : 'No staged files'}
        </span>
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className={`${btnPrimary} h-7`}
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
