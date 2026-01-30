import { memo, useEffect, useCallback } from 'react'
import { GitBranch, Terminal as TerminalIcon, Plus, X, Trash2, ExternalLink, GitMerge, AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react'
import type { Worktree, TerminalSession, PRStatus } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface WorktreeItemProps {
  worktree: Worktree
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (e: React.MouseEvent, id: string) => void
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
  onCloseTerminal,
  onRemove,
}: WorktreeItemProps) {
  const prStatus = useProjectStore((s) => s.prStatus[worktree.id])
  const ghAvailable = useProjectStore((s) => s.ghAvailable)
  const setPRStatus = useProjectStore((s) => s.setPRStatus)
  const setGhAvailable = useProjectStore((s) => s.setGhAvailable)

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

    // Listen for updates
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

  // Terminal state colors
  const stateColors: Record<string, string> = {
    busy: 'text-blue-500',
    permission: 'text-orange-500',
    ready: 'text-green-500',
    stopped: 'text-red-500',
  }

  const stateDots: Record<string, string> = {
    busy: 'bg-blue-500',
    permission: 'bg-orange-500',
    question: 'bg-orange-500',
    done: 'bg-green-500',
    stopped: 'bg-red-500',
  }

  const inputStates = ['done', 'permission', 'question'] as const
  const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

  const visibleStates = ['busy', 'done', 'permission', 'question'] as const
  const isVisibleState = (state: string) => visibleStates.includes(state as typeof visibleStates[number])

  // Merge button visibility
  const canMerge = prStatus && !prStatus.noPR &&
    prStatus.state === 'OPEN' &&
    prStatus.mergeable === 'MERGEABLE' &&
    prStatus.mergeStateStatus === 'CLEAN'

  const hasPR = prStatus && !prStatus.noPR && prStatus.state === 'OPEN'
  const hasConflicts = prStatus?.mergeable === 'CONFLICTING'

  return (
    <div className="mt-1 border-l border-primary/30 ml-6">
      {/* Worktree Header */}
      <div className="group flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-sidebar-foreground">
        <GitBranch className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="flex-1 text-xs font-medium truncate" title={worktree.branch}>
          {worktree.name}
        </span>

        {/* PR number badge */}
        {hasPR && (
          <button
            onClick={handleOpenPR}
            className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
            title={`Open PR #${prStatus.number} in browser`}
          >
            #{prStatus.number}
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {ghAvailable?.installed && ghAvailable?.authenticated && (
            <button
              onClick={handleRefresh}
              className="p-0.5 rounded hover:bg-border"
              title="Refresh PR status"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateTerminal()
            }}
            className="p-0.5 rounded hover:bg-border"
            title="New Terminal in Worktree"
          >
            <Plus className="w-3 h-3" />
          </button>
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

      {/* PR Status Row */}
      {hasPR && (
        <div className="flex items-center gap-1.5 px-3 py-0.5 ml-5 flex-wrap">
          {/* CI Status */}
          <CIStatusIcon status={prStatus} />

          {/* Conflicts */}
          {hasConflicts && (
            <span className="flex items-center gap-0.5 text-[10px] text-red-500" title="Merge conflicts detected">
              <AlertTriangle className="w-3 h-3" />
              Conflicts
            </span>
          )}

          {/* Diff stats */}
          {(prStatus.additions !== undefined || prStatus.deletions !== undefined) && (
            <span className="text-[10px] font-mono">
              <span className="text-green-500">+{prStatus.additions ?? 0}</span>
              {' '}
              <span className="text-red-500">-{prStatus.deletions ?? 0}</span>
            </span>
          )}

          {/* Review status */}
          <ReviewBadge decision={prStatus.reviewDecision} />

          {/* Merge button */}
          {canMerge && (
            <button
              onClick={handleMerge}
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
              title="Merge & Squash this PR"
            >
              <GitMerge className="w-3 h-3" />
              Merge
            </button>
          )}
        </div>
      )}

      {/* Terminal List */}
      {terminals.length > 0 && (
        <ul className="ml-4 space-y-0.5">
          {terminals.map((terminal) => (
            <li
              key={terminal.id}
              onClick={() => onSelectTerminal(terminal.id)}
              className={`
                group flex items-center gap-2 px-3 py-1 cursor-pointer
                transition-colors duration-150
                ${terminal.id === activeTerminalId
                  ? 'bg-sidebar-accent text-sidebar-foreground rounded-md'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 rounded-md'}
              `}
            >
              <TerminalIcon
                className={`w-3 h-3 flex-shrink-0 ${stateColors[terminal.state]}`}
              />
              <span className="flex-1 text-xs truncate">{terminal.title}</span>

              {/* State indicator */}
              {isVisibleState(terminal.state) && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${stateDots[terminal.state]} ${
                    isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
                  }`}
                />
              )}

              {/* Close button */}
              <button
                onClick={(e) => onCloseTerminal(e, terminal.id)}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
                title="Close Terminal"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state */}
      {terminals.length === 0 && (
        <div className="ml-4 px-3 py-1">
          <button
            onClick={onCreateTerminal}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Terminal
          </button>
        </div>
      )}
    </div>
  )
})
