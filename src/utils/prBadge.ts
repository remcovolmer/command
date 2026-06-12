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
