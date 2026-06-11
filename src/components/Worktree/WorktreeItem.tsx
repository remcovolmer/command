import { memo, useState, useEffect, useCallback } from 'react'
import { GitBranch, Trash2, ExternalLink, GitMerge, RefreshCw, Loader2 } from 'lucide-react'
import type { Worktree, TerminalSession, PRStatus, PRCheckStatus } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { STATE_DOT_COLORS, isAttentionState, isInputState, isVisibleState } from '../../utils/terminalState'
import { closeWorktreeTerminals } from '../../utils/worktreeCleanup'
import { getPRBadge, type PRBadgeKind } from '../../utils/prBadge'
import { AttentionChip, AttentionRail, attentionRowBg } from '../Sidebar/AttentionRail'

interface WorktreeItemProps {
  worktree: Worktree
  projectPath: string
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onRemove: () => void
}

const BADGE_KIND_CLASSES: Record<PRBadgeKind, string> = {
  conflict: 'bg-red-500/15 text-red-600 dark:text-red-400',
  'ci-fail': 'bg-red-500/15 text-red-600 dark:text-red-400',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  review: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ready: 'bg-green-500/15 text-green-600 dark:text-green-400',
}

function PRStatusBadge({ status }: { status: PRStatus }) {
  const [hovered, setHovered] = useState(false)
  const badge = getPRBadge(status)
  if (!badge) return null

  const checks = status.statusCheckRollup ?? []
  const hasDiffstat = status.additions !== undefined || status.deletions !== undefined
  const hasPopover = checks.length > 0 || hasDiffstat

  return (
    <span
      className="relative flex-shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`text-[10px] leading-none font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${BADGE_KIND_CLASSES[badge.kind]}`}>
        {badge.label}
      </span>
      {hovered && hasPopover && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1.5 px-2 text-xs whitespace-nowrap">
          {hasDiffstat && (
            <div className="font-mono py-0.5">
              <span className="text-green-500">+{status.additions ?? 0}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-500">-{status.deletions ?? 0}</span>
            </div>
          )}
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

  // Gray-but-clickable when checks fail or run (not all checks are blocking);
  // the window.confirm warning in handleMerge remains the guardrail.
  const btnColor = anyFail || anyPending
    ? 'bg-gray-500 hover:bg-gray-600'
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
  const markPRStatusStale = useProjectStore((s) => s.markPRStatusStale)
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

    const unsubUpdate = api.github.onPRStatusUpdate((k, status) => {
      if (k === key) {
        setPRStatus(key, status)
      }
    })

    const unsubStale = api.github.onPRStatusStale((k, errorMessage) => {
      if (k === key) {
        markPRStatusStale(key, errorMessage)
      }
    })

    return () => {
      api.github.stopPolling(key)
      unsubUpdate()
      unsubStale()
    }
  }, [worktree.id, worktree.path, ghAvailable, setPRStatus, markPRStatusStale])

  const handleRefresh = useCallback(async () => {
    const api = getElectronAPI()
    try {
      const status = await api.github.getPRStatus(worktree.path)
      setPRStatus(worktree.id, status)
    } catch (err) {
      console.error('[WorktreeItem] Failed to refresh PR status:', err)
      const message = err instanceof Error ? err.message : 'Refresh failed'
      markPRStatusStale(worktree.id, message)
    }
  }, [worktree.id, worktree.path, setPRStatus, markPRStatusStale])

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

  // Merge button visibility (show for any open, conflict-free PR with fresh data)
  // Hide while stale so the destructive merge can't fire against acknowledged-stale checks.
  const showMergeButton = prStatus && !prStatus.noPR &&
    prStatus.state === 'OPEN' &&
    prStatus.mergeable === 'MERGEABLE' &&
    !prStatus.stale

  const hasPR = prStatus && !prStatus.noPR && prStatus.state === 'OPEN'

  const isActive = terminal?.id === activeTerminalId

  const isAttention = terminal ? isAttentionState(terminal.state) : false

  return (
    <div className="mt-0.5 border-l border-primary/30 ml-6">
      {/* Row 1: Branch info + hover actions */}
      <div
        onClick={handleRowClick}
        className={`
          group relative flex items-center gap-2 px-3 py-1.5 cursor-pointer
          transition-colors duration-150 rounded-t-md
          ${attentionRowBg(isAttention, isActive)}
          ${isActive ? 'text-sidebar-foreground' : 'text-muted-foreground hover:text-sidebar-foreground'}
          ${!hasPR ? 'rounded-b-md' : ''}
        `}
      >
        {isAttention && <AttentionRail />}
        {/* Branch icon */}
        <GitBranch className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />

        {/* Branch name */}
        <span className="flex-1 text-xs font-medium truncate" title={worktree.branch}>
          {worktree.name}
        </span>

        {/* Right side: State dot + hover actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Attention chip - permission/question rows say what they need */}
          {isAttention && <AttentionChip />}
          {/* Terminal state dot - only for visible non-attention states (busy/done) */}
          {terminal && !isAttention && isVisibleState(terminal.state) && (
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
            ${isActive ? 'bg-[var(--sidebar-highlight)] rounded-b-md' : ''}
            ${prStatus.stale ? 'opacity-60' : ''}
          `}
          title={prStatus.stale ? `PR status update failed — showing last known data. ${prStatus.error ?? ''}`.trim() : undefined}
        >
          {/* PR number - neutral clickable chip */}
          <button
            onClick={(e) => { e.stopPropagation(); handleOpenPR() }}
            className="flex items-center gap-0.5 text-[10px] leading-none px-1 py-0.5 rounded bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={`Open PR #${prStatus.number} in browser`}
          >
            #{prStatus.number}
            <ExternalLink className="w-2.5 h-2.5" />
          </button>

          {/* Composite status badge (conflict > CI-fail > pending > review > ready);
              diffstat and per-check details live in its hover popover */}
          <PRStatusBadge status={prStatus} />

          {/* Merge button */}
          {showMergeButton && (
            <MergeButton checks={prStatus.statusCheckRollup ?? []} onMerge={handleMerge} isMerging={isMerging} />
          )}
        </div>
      )}
    </div>
  )
})
