import { memo, useEffect, useCallback } from 'react'
import { GitBranch, Trash2, ExternalLink, GitMerge, AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react'
import type { Worktree, TerminalSession, PRStatus } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface WorktreeItemProps {
  worktree: Worktree
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onRemove: () => void
}

function CIStatusIcon({ status }: { status: PRStatus }) {
  const checks = status.statusCheckRollup ?? []
  if (checks.length === 0) return null

  const allPass = checks.every(c => c.bucket === 'pass')
  const anyFail = checks.some(c => c.bucket === 'fail')
  const anyPending = checks.some(c => c.bucket === 'pending')

  const tooltip = checks.map(c => `${c.bucket === 'pass' ? '\u2713' : c.bucket === 'fail' ? '\u2717' : '\u25cb'} ${c.name}`).join('\n')

  if (allPass) return <span title={tooltip}><CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" /></span>
  if (anyFail) return <span title={tooltip}><XCircle className="w-3 h-3 text-red-500 flex-shrink-0" /></span>
  if (anyPending) return <span title={tooltip}><Clock className="w-3 h-3 text-yellow-500 flex-shrink-0" /></span>
  return null
}

function ReviewBadge({ decision }: { decision: PRStatus['reviewDecision'] }) {
  if (!decision) return null
  const map: Record<string, { label: string; cls: string }> = {
    APPROVED: { label: 'Approved', cls: 'text-green-600 bg-green-500/10' },
    CHANGES_REQUESTED: { label: 'Changes', cls: 'text-orange-600 bg-orange-500/10' },
    REVIEW_REQUIRED: { label: 'Review', cls: 'text-yellow-600 bg-yellow-500/10' },
  }
  const info = map[decision]
  if (!info) return null
  return (
    <span className={`text-[10px] px-1 py-0.5 rounded ${info.cls}`} title={`Review: ${decision}`}>
      {info.label}
    </span>
  )
}

export const WorktreeItem = memo(function WorktreeItem({
  worktree,
  terminals,
  activeTerminalId,
  onCreateTerminal,
  onSelectTerminal,
  onRemove,
}: WorktreeItemProps) {
  const prStatus = useProjectStore((s) => s.prStatus[worktree.id])
  const ghAvailable = useProjectStore((s) => s.ghAvailable)
  const setPRStatus = useProjectStore((s) => s.setPRStatus)
  const setGhAvailable = useProjectStore((s) => s.setGhAvailable)

  // The single terminal for this worktree (1:1 model)
  const terminal = terminals[0] ?? null

  // Check gh availability once
  useEffect(() => {
    if (ghAvailable !== null) return
    const api = getElectronAPI()
    api.github.checkAvailable().then(setGhAvailable).catch(() => {})
  }, [ghAvailable, setGhAvailable])

  // Start/stop polling for this worktree
  useEffect(() => {
    if (!ghAvailable?.installed || !ghAvailable?.authenticated) return

    const api = getElectronAPI()
    const key = worktree.id
    api.github.startPolling(key, worktree.path)

    const unsub = api.github.onPRStatusUpdate((k, status) => {
      if (k === key) {
        setPRStatus(key, status)
      }
    })

    return () => {
      api.github.stopPolling(key)
      unsub()
    }
  }, [worktree.id, worktree.path, ghAvailable, setPRStatus])

  const handleRefresh = useCallback(async () => {
    const api = getElectronAPI()
    try {
      const status = await api.github.getPRStatus(worktree.path)
      setPRStatus(worktree.id, status)
    } catch {}
  }, [worktree.id, worktree.path, setPRStatus])

  const handleMerge = useCallback(async () => {
    if (!prStatus?.number) return
    const confirmed = window.confirm(`Merge & Squash PR #${prStatus.number}?\n\n${prStatus.title}`)
    if (!confirmed) return

    const api = getElectronAPI()
    try {
      await api.github.mergePR(worktree.path, prStatus.number)
      api.notification.show('PR Merged', `PR #${prStatus.number} merged successfully`)
      handleRefresh()
    } catch (err) {
      api.notification.show('Merge Failed', err instanceof Error ? err.message : 'Unknown error')
      handleRefresh()
    }
  }, [prStatus, worktree.path, handleRefresh])

  const handleOpenPR = useCallback(() => {
    if (prStatus?.url) {
      window.open(prStatus.url, '_blank')
    }
  }, [prStatus])

  const handleRowClick = useCallback(() => {
    if (terminal && terminal.state !== 'stopped') {
      // Terminal exists and alive — select it
      onSelectTerminal(terminal.id)
    } else {
      // No terminal or stopped — auto-create
      onCreateTerminal()
    }
  }, [terminal, onSelectTerminal, onCreateTerminal])

  const stateDots: Record<string, string> = {
    busy: 'bg-blue-500',
    permission: 'bg-orange-500',
    question: 'bg-orange-500',
    done: 'bg-green-500',
    stopped: 'bg-red-500',
  }

  const inputStates = ['done', 'permission', 'question'] as const
  const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

  // Merge button visibility
  const canMerge = prStatus && !prStatus.noPR &&
    prStatus.state === 'OPEN' &&
    prStatus.mergeable === 'MERGEABLE' &&
    prStatus.mergeStateStatus === 'CLEAN'

  const hasPR = prStatus && !prStatus.noPR && prStatus.state === 'OPEN'
  const hasConflicts = prStatus?.mergeable === 'CONFLICTING'

  const isActive = terminal?.id === activeTerminalId

  return (
    <div className="mt-0.5 border-l border-primary/30 ml-6">
      {/* Single unified row */}
      <div
        onClick={handleRowClick}
        className={`
          group flex items-center gap-2 px-3 py-1.5 cursor-pointer
          transition-colors duration-150
          ${isActive
            ? 'bg-sidebar-accent text-sidebar-foreground rounded-md'
            : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 rounded-md'}
        `}
      >
        {/* Branch icon */}
        <GitBranch className="w-3.5 h-3.5 text-primary flex-shrink-0" />

        {/* Terminal state dot */}
        {terminal && (
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateDots[terminal.state] ?? 'bg-gray-500'} ${
              isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
            }`}
          />
        )}
        {!terminal && (
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-500/50" />
        )}

        {/* Branch name + title */}
        <span className="flex-1 text-xs font-medium truncate" title={worktree.branch}>
          {worktree.name}
        </span>
        {/* Right-aligned: PR info + controls */}
        <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
          {/* PR number badge */}
          {hasPR && (
            <button
              onClick={(e) => { e.stopPropagation(); handleOpenPR() }}
              className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
              title={`Open PR #${prStatus.number} in browser`}
            >
              #{prStatus.number}
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          )}

          {/* CI Status */}
          {hasPR && <CIStatusIcon status={prStatus} />}

          {/* Diff stats */}
          {hasPR && (prStatus.additions !== undefined || prStatus.deletions !== undefined) && (
            <span className="text-[10px] font-mono">
              <span className="text-green-500">+{prStatus.additions ?? 0}</span>
              {' '}
              <span className="text-red-500">-{prStatus.deletions ?? 0}</span>
            </span>
          )}

          {/* Conflicts */}
          {hasConflicts && (
            <span className="flex items-center gap-0.5 text-[10px] text-red-500" title="Merge conflicts">
              <AlertTriangle className="w-3 h-3" />
            </span>
          )}

          {/* Review status */}
          {hasPR && <ReviewBadge decision={prStatus.reviewDecision} />}

          {/* Merge button */}
          {canMerge && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMerge() }}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
              title="Merge & Squash this PR"
            >
              <GitMerge className="w-3 h-3" />
              Merge
            </button>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {ghAvailable?.installed && ghAvailable?.authenticated && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRefresh() }}
                className="p-0.5 rounded hover:bg-border"
                title="Refresh PR status"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="p-0.5 rounded hover:bg-border text-muted-foreground hover:text-destructive"
              title="Remove Worktree"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
