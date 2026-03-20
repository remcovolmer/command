import { memo, useState, useEffect, useCallback } from 'react'
import { GitBranch, Trash2, ExternalLink, GitMerge, AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw, Loader2 } from 'lucide-react'
import type { Worktree, TerminalSession, PRStatus, PRCheckStatus } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { STATE_DOT_COLORS, isInputState, isVisibleState } from '../../utils/terminalState'
import { closeWorktreeTerminals } from '../../utils/worktreeCleanup'

interface WorktreeItemProps {
  worktree: Worktree
  projectPath: string
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onRemove: () => void
}

function CIStatusIcon({ status }: { status: PRStatus }) {
  const [hovered, setHovered] = useState(false)
  const checks = status.statusCheckRollup ?? []
  if (checks.length === 0) return null

  const allPass = checks.every(c => c.bucket === 'pass')
  const anyFail = checks.some(c => c.bucket === 'fail')
  const anyPending = checks.some(c => c.bucket === 'pending')

  let Icon = CheckCircle2
  let iconClass = 'text-green-500'
  if (anyFail) { Icon = XCircle; iconClass = 'text-red-500' }
  else if (anyPending) { Icon = Clock; iconClass = 'text-yellow-500' }
  else if (!allPass) return null

  return (
    <span
      className="relative flex-shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon className={`w-3 h-3 ${iconClass}`} />
      {hovered && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1.5 px-2 text-xs whitespace-nowrap">
          {checks.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <span className={c.bucket === 'pass' ? 'text-green-500' : c.bucket === 'fail' ? 'text-red-500' : 'text-yellow-500'}>
                {c.bucket === 'pass' ? '\u2713' : c.bucket === 'fail' ? '\u2717' : '\u25cb'}
              </span>
              <span className="text-popover-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
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

function MergeButton({ checks, onMerge, isMerging }: { checks: PRCheckStatus[]; onMerge: () => void; isMerging: boolean }) {
  if (isMerging) {
    return (
      <button
        disabled
        className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-white transition-colors ml-auto bg-gray-500 opacity-75 cursor-not-allowed"
        title="Merging in progress..."
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        Merging...
      </button>
    )
  }

  const failNames = checks.filter(c => c.bucket === 'fail').map(c => c.name)
  const pendingNames = checks.filter(c => c.bucket === 'pending').map(c => c.name)
  const anyFail = failNames.length > 0
  const anyPending = pendingNames.length > 0

  const btnColor = anyFail
    ? 'bg-red-600 hover:bg-red-700'
    : anyPending
      ? 'bg-yellow-600 hover:bg-yellow-700'
      : 'bg-green-600 hover:bg-green-700'

  const title = anyFail
    ? `Merge & Squash (checks failing: ${failNames.join(', ')})`
    : anyPending
      ? `Merge & Squash (checks running: ${pendingNames.join(', ')})`
      : 'Merge & Squash this PR'

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onMerge() }}
      className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-white transition-colors ml-auto ${btnColor}`}
      title={title}
    >
      {anyPending && !anyFail
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <GitMerge className="w-3 h-3" />
      }
      Merge
    </button>
  )
}

export const WorktreeItem = memo(function WorktreeItem({
  worktree,
  projectPath,
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
  const removeTerminal = useProjectStore((s) => s.removeTerminal)
  const removeWorktree = useProjectStore((s) => s.removeWorktree)

  const [isMerging, setIsMerging] = useState(false)

  // The single terminal for this worktree (1:1 model)
  const terminal = terminals[0] ?? null

  // Check gh availability once
  useEffect(() => {
    if (ghAvailable !== null) return
    const api = getElectronAPI()
    api.github.checkAvailable().then(setGhAvailable).catch(() => {})
  }, [ghAvailable, setGhAvailable])

  // Start/stop polling for this worktree (GitHubService applies its own jitter)
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
    } catch (err) {
      console.error('[WorktreeItem] Failed to refresh PR status:', err)
    }
  }, [worktree.id, worktree.path, setPRStatus])

  const handleMerge = useCallback(async () => {
    if (!prStatus?.number) return

    const api = getElectronAPI()
    try {
      // Check for uncommitted changes before merging
      const hasChanges = await api.worktree.hasChanges(worktree.id)

      // Build warning message parts
      const warnings: string[] = []
      const currentChecks = prStatus?.statusCheckRollup ?? []
      const failingChecks = currentChecks.filter(c => c.bucket === 'fail')
      const pendingChecks = currentChecks.filter(c => c.bucket === 'pending')
      if (failingChecks.length > 0) {
        warnings.push(`WARNING: Some checks are failing (${failingChecks.map(c => c.name).join(', ')}).`)
      } else if (pendingChecks.length > 0) {
        warnings.push(`WARNING: Some checks are still running.`)
      }
      if (hasChanges) {
        warnings.push(`WARNING: This worktree has uncommitted changes that will be lost.`)
      }

      const warningBlock = warnings.length > 0 ? `\n\n${warnings.join('\n\n')}\n\n` : '\n\n'
      const message = `Merge & Squash PR #${prStatus.number}?${warningBlock}This will also remove the worktree.`
      const confirmed = window.confirm(message)
      if (!confirmed) return

      setIsMerging(true)
      try {
        // Merge from main project path (not worktree) to avoid branch-in-use error
        await api.github.mergePR(projectPath, prStatus.number)

        // Close active terminals before removal (prevents EBUSY on Windows)
        await closeWorktreeTerminals(terminals, removeTerminal)

        // Remove the worktree (also deletes local branch)
        try {
          await api.worktree.remove(worktree.id, hasChanges)
        } catch (err) {
          console.error('[WorktreeItem] Worktree removal failed after merge:', err)
          api.github.stopPolling(worktree.id)
          api.notification.show('PR Merged', `PR #${prStatus.number} merged, but worktree removal failed. Remove it manually.`)
          return
        }

        // Clean up store and stop polling
        removeWorktree(worktree.id)
        api.github.stopPolling(worktree.id)

        api.notification.show('PR Merged', `PR #${prStatus.number} merged and worktree removed`)
      } finally {
        setIsMerging(false)
      }
    } catch (err) {
      api.notification.show('Merge Failed', err instanceof Error ? err.message : 'Unknown error')
    }
  }, [prStatus, projectPath, worktree.id, terminals, removeTerminal, removeWorktree])

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

  // Merge button visibility (show for any open, conflict-free PR)
  const showMergeButton = prStatus && !prStatus.noPR &&
    prStatus.state === 'OPEN' &&
    prStatus.mergeable === 'MERGEABLE'

  const hasPR = prStatus && !prStatus.noPR && prStatus.state === 'OPEN'
  const hasConflicts = prStatus?.mergeable === 'CONFLICTING'

  const isActive = terminal?.id === activeTerminalId

  return (
    <div className="mt-0.5 border-l border-primary/30 ml-6">
      {/* Row 1: Branch info + hover actions */}
      <div
        onClick={handleRowClick}
        className={`
          group flex items-center gap-2 px-3 py-1.5 cursor-pointer
          transition-colors duration-150
          ${isActive
            ? 'bg-sidebar-accent text-sidebar-foreground rounded-t-md'
            : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 rounded-t-md'}
          ${!hasPR ? (isActive ? 'rounded-b-md' : 'rounded-b-md') : ''}
        `}
      >
        {/* Branch icon */}
        <GitBranch className="w-3.5 h-3.5 text-primary flex-shrink-0" />

        {/* Branch name */}
        <span className="flex-1 text-xs font-medium truncate" title={worktree.branch}>
          {worktree.name}
        </span>

        {/* Right side: State dot + hover actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Terminal state dot - only show for visible states */}
          {terminal && isVisibleState(terminal.state) && (
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_DOT_COLORS[terminal.state]} ${
                isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
              }`}
            />
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

      {/* Row 2: PR info (only when PR exists) */}
      {hasPR && (
        <div
          className={`
            flex items-center gap-1.5 pl-9 pr-3 py-1 text-muted-foreground
            ${isActive ? 'bg-sidebar-accent rounded-b-md' : ''}
          `}
        >
          {/* PR number */}
          <button
            onClick={(e) => { e.stopPropagation(); handleOpenPR() }}
            className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
            title={`Open PR #${prStatus.number} in browser`}
          >
            #{prStatus.number}
            <ExternalLink className="w-2.5 h-2.5" />
          </button>

          {/* CI Status */}
          <CIStatusIcon status={prStatus} />

          {/* Diff stats */}
          {(prStatus.additions !== undefined || prStatus.deletions !== undefined) && (
            <span className="text-[10px] font-mono bg-muted/50 rounded px-1 py-0.5 leading-none">
              <span className="text-green-500">+{prStatus.additions ?? 0}</span>
              <span className="text-muted-foreground">/</span>
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
          <ReviewBadge decision={prStatus.reviewDecision} />

          {/* Merge button */}
          {showMergeButton && (
            <MergeButton checks={prStatus.statusCheckRollup ?? []} onMerge={handleMerge} isMerging={isMerging} />
          )}
        </div>
      )}
    </div>
  )
})
