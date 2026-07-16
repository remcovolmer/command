import { memo, useState, useEffect, useCallback } from 'react'
import { GitBranch, Trash2, ExternalLink, GitMerge, RefreshCw, Loader2 } from 'lucide-react'
import type { AgentType, Worktree, TerminalSession, PRStatus, PRCheckStatus } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { isAttentionState } from '../../utils/terminalState'
import { closeWorktreeTerminals } from '../../utils/worktreeCleanup'
import { AgentBadge } from '../AgentBadge'
import { ContextMenu, type ContextMenuEntry } from '../Sidebar/ContextMenu'
import { AGENT_DISPLAY, AGENT_IDS, isAgentType } from '@shared/agents'
import {
  getPRBadge,
  shouldShowMergeButton,
  type PRBadge,
  type PRBadgeKind,
} from '../../utils/prBadge'
import { AttentionChip, AttentionRail, attentionRowBg, CHIP_BASE } from '../Sidebar/AttentionRail'

interface WorktreeItemProps {
  worktree: Worktree
  projectPath: string
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onSwitchAgent: (terminal: TerminalSession, agent: AgentType) => void
  onRemove: () => void
}

const BADGE_KIND_CLASSES: Record<PRBadgeKind, string> = {
  conflict: 'bg-red-500/15 text-red-600 dark:text-red-400',
  'ci-fail': 'bg-red-500/15 text-red-600 dark:text-red-400',
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  review: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ready: 'bg-green-500/15 text-green-600 dark:text-green-400',
}

const REVIEW_DECISION_LABELS: Record<string, string> = {
  CHANGES_REQUESTED: 'changes requested',
  REVIEW_REQUIRED: 'required',
  APPROVED: 'approved',
}

function PRStatusBadge({ status, badge }: { status: PRStatus; badge: PRBadge }) {
  const [hovered, setHovered] = useState(false)

  const checks = status.statusCheckRollup ?? []
  const hasDiffstat = status.additions !== undefined || status.deletions !== undefined
  const reviewLabel = status.reviewDecision
    ? REVIEW_DECISION_LABELS[status.reviewDecision]
    : undefined
  const hasPopover = checks.length > 0 || hasDiffstat || Boolean(reviewLabel)

  return (
    <span
      className="relative flex-shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`${CHIP_BASE} ${BADGE_KIND_CLASSES[badge.kind]}`}>{badge.label}</span>
      {hovered && hasPopover && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1.5 px-2 text-xs whitespace-nowrap">
          {hasDiffstat && (
            <div className="font-mono py-0.5">
              <span className="text-green-500">+{status.additions ?? 0}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-500">-{status.deletions ?? 0}</span>
            </div>
          )}
          {/* Review decision is masked when a higher-priority badge wins; keep it discoverable here */}
          {reviewLabel && (
            <div className="py-0.5 text-popover-foreground">Review: {reviewLabel}</div>
          )}
          {checks.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <span
                className={
                  c.bucket === 'pass'
                    ? 'text-green-500'
                    : c.bucket === 'fail'
                      ? 'text-red-500'
                      : 'text-yellow-500'
                }
              >
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

interface MergeButtonProps {
  badgeKind: PRBadgeKind
  checks: PRCheckStatus[]
  onMerge: () => void
  isMerging: boolean
}

// Button color follows the badge kind computed once in the PR row (single
// source of truth with the chip): ready → green, anything else gray-but-
// clickable (not all checks are blocking); the window.confirm warning in
// handleMerge remains the guardrail and re-derives from click-time data.
function MergeButton({ badgeKind, checks, onMerge, isMerging }: MergeButtonProps) {
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

  const btnColor =
    badgeKind === 'ready' ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-500 hover:bg-gray-600'

  // Check names only feed the tooltip detail; the decision lives in badgeKind
  const failNames = checks.filter((c) => c.bucket === 'fail').map((c) => c.name)
  const pendingNames = checks.filter((c) => c.bucket === 'pending').map((c) => c.name)
  const title =
    badgeKind === 'ci-fail'
      ? `Merge & Squash (checks failing: ${failNames.join(', ')})`
      : badgeKind === 'pending'
        ? `Merge & Squash (checks running: ${pendingNames.join(', ')})`
        : badgeKind === 'review'
          ? 'Merge & Squash (review outstanding)'
          : 'Merge & Squash this PR'

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onMerge()
      }}
      className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded text-white transition-colors ml-auto ${btnColor}`}
      title={title}
    >
      {badgeKind === 'pending' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <GitMerge className="w-3 h-3" />
      )}
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
  onSwitchAgent,
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // The single terminal for this worktree (1:1 model)
  const terminal = terminals[0] ?? null

  // Right-click the worktree row to switch its chat's agent (close + restart with
  // the chosen agent in the same worktree; git state stays).
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!terminal || !isAgentType(terminal.type)) return
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY })
    },
    [terminal]
  )
  const agentItems: ContextMenuEntry[] =
    terminal && isAgentType(terminal.type)
      ? AGENT_IDS.filter((a) => a !== terminal.type).map((a) => ({
          label: `Switch to ${AGENT_DISPLAY[a].label}`,
          onClick: () => {
            setContextMenu(null)
            onSwitchAgent(terminal, a)
          },
        }))
      : []

  // Check gh availability once
  useEffect(() => {
    if (ghAvailable !== null) return
    const api = getElectronAPI()
    api.github
      .checkAvailable()
      .then(setGhAvailable)
      .catch(() => {})
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
      const failingChecks = currentChecks.filter((c) => c.bucket === 'fail')
      const pendingChecks = currentChecks.filter((c) => c.bucket === 'pending')
      if (failingChecks.length > 0) {
        warnings.push(
          `WARNING: Some checks are failing (${failingChecks.map((c) => c.name).join(', ')}).`
        )
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
          api.notification.show(
            'PR Merged',
            `PR #${prStatus.number} merged, but worktree removal failed. Remove it manually.`
          )
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

  // Merge button visibility: any open PR that isn't CONFLICTING. UNKNOWN
  // mergeability (lazy compute after a push) and stale rows (last poll failed)
  // still get the button — the merge runs against GitHub's live state via gh
  // and handleMerge's confirm dialog is the guardrail. See shouldShowMergeButton.
  const showMergeButton = shouldShowMergeButton(prStatus)

  const hasPR = prStatus && !prStatus.noPR && prStatus.state === 'OPEN'

  // Computed once per render; chip and merge button both derive from this badge
  const badge = hasPR ? getPRBadge(prStatus) : null

  const isActive = terminal?.id === activeTerminalId

  const isAttention = terminal ? isAttentionState(terminal.state) : false

  return (
    <>
      <div className="mt-0.5 border-l border-primary/30 ml-6">
      {/* Row 1: Branch info + hover actions */}
      <div
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
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
          {/* The chat's agent logo, tinted by state (green=done, gray=busy,
              orange=needs input, red=stopped) — doubles as the status indicator,
              so no separate dot. Right-click the row to switch agent. */}
          {terminal && isAgentType(terminal.type) && (
            <AgentBadge type={terminal.type} state={terminal.state} />
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {ghAvailable?.installed && ghAvailable?.authenticated && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleRefresh()
                }}
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
          title={
            prStatus.stale
              ? `PR status update failed — showing last known data. ${prStatus.error ?? ''}`.trim()
              : undefined
          }
        >
          {/* PR number - neutral clickable chip */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleOpenPR()
            }}
            className="flex items-center gap-0.5 text-[10px] leading-none px-1 py-0.5 rounded bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={`Open PR #${prStatus.number} in browser`}
          >
            #{prStatus.number}
            <ExternalLink className="w-2.5 h-2.5" />
          </button>

          {/* Composite status badge (conflict > CI-fail > pending > review > ready);
              diffstat, review decision and per-check details live in its hover popover */}
          {badge && <PRStatusBadge status={prStatus} badge={badge} />}

          {/* Merge button */}
          {showMergeButton && badge && (
            <MergeButton
              badgeKind={badge.kind}
              checks={prStatus.statusCheckRollup ?? []}
              onMerge={handleMerge}
              isMerging={isMerging}
            />
          )}
        </div>
      )}
      </div>
      {contextMenu && agentItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={agentItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
})
