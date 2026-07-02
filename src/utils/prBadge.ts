import type { PRStatus } from '../types'

export type PRBadgeKind = 'conflict' | 'ci-fail' | 'pending' | 'review' | 'ready'

export interface PRBadge {
  kind: PRBadgeKind
  label: string
}

/**
 * Collapses a PR's status into a single badge for the sidebar PR row.
 *
 * Priority chain (first match wins): conflict > CI-fail > pending > review > ready.
 * Returns null when there is no open PR to summarize.
 */
export function getPRBadge(prStatus: PRStatus): PRBadge | null {
  if (prStatus.noPR || prStatus.state !== 'OPEN') return null

  if (prStatus.mergeable === 'CONFLICTING') {
    return { kind: 'conflict', label: 'conflict' }
  }

  const checks = prStatus.statusCheckRollup ?? []
  if (checks.some((c) => c.bucket === 'fail')) {
    return { kind: 'ci-fail', label: 'CI ✗' }
  }
  // Right after a push gh briefly reports mergeable UNKNOWN with an empty check
  // list; that must read as pending, not as a misleading green "klaar". An empty
  // check list with mergeable MERGEABLE stays ready (repos without CI).
  if (checks.some((c) => c.bucket === 'pending') || prStatus.mergeable === 'UNKNOWN') {
    return { kind: 'pending', label: 'pending' }
  }

  if (
    prStatus.reviewDecision === 'CHANGES_REQUESTED' ||
    prStatus.reviewDecision === 'REVIEW_REQUIRED'
  ) {
    return { kind: 'review', label: 'review' }
  }

  return { kind: 'ready', label: '✓ klaar' }
}

/**
 * Whether the worktree PR row should offer a Merge & Squash button.
 *
 * Shows for any open PR that GitHub does not report as CONFLICTING. Two states
 * that used to hide the button now qualify on purpose:
 *   - `mergeable: 'UNKNOWN'` — GitHub computes mergeability lazily/asynchronously
 *     and returns UNKNOWN right after a PR is created and after every push, until
 *     the next poll resolves it. A strict `=== 'MERGEABLE'` gate made the button
 *     vanish during that recurring window.
 *   - `stale` — the last poll failed, so we show last-known-good data dimmed.
 *
 * Both are safe to offer: the merge runs `gh pr merge` against GitHub's *live*
 * state (never the cached status here), and handleMerge's confirm dialog
 * re-derives failing/pending-check and uncommitted-change warnings at click
 * time. Those are the real guardrails; CONFLICTING is the only hard block.
 */
export function shouldShowMergeButton(prStatus: PRStatus | undefined): boolean {
  if (!prStatus || prStatus.noPR) return false
  if (prStatus.state !== 'OPEN') return false
  return prStatus.mergeable !== 'CONFLICTING'
}
