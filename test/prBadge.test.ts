import { describe, test, expect } from 'vitest'
import { getPRBadge, shouldShowMergeButton } from '../src/utils/prBadge'
import type { PRStatus, PRCheckStatus } from '../src/types'

function makeCheck(bucket: 'pass' | 'fail' | 'pending', name?: string): PRCheckStatus {
  return { name: name ?? `check-${bucket}`, state: bucket.toUpperCase(), bucket }
}

function makePRStatus(overrides: Partial<PRStatus> = {}): PRStatus {
  return {
    noPR: false,
    number: 42,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    statusCheckRollup: [makeCheck('pass')],
    ...overrides,
  }
}

describe('getPRBadge — no badge without an open PR', () => {
  test('noPR returns null', () => {
    expect(getPRBadge(makePRStatus({ noPR: true }))).toBeNull()
  })

  test('CLOSED state returns null', () => {
    expect(getPRBadge(makePRStatus({ state: 'CLOSED' }))).toBeNull()
  })

  test('MERGED state returns null', () => {
    expect(getPRBadge(makePRStatus({ state: 'MERGED' }))).toBeNull()
  })
})

describe('getPRBadge — priority chain', () => {
  test('conflict wins over failing checks', () => {
    const badge = getPRBadge(
      makePRStatus({
        mergeable: 'CONFLICTING',
        statusCheckRollup: [makeCheck('fail'), makeCheck('pending')],
      })
    )
    expect(badge).toEqual({ kind: 'conflict', label: 'conflict' })
  })

  test('failing check without conflict yields ci-fail', () => {
    const badge = getPRBadge(
      makePRStatus({
        statusCheckRollup: [makeCheck('pass'), makeCheck('fail'), makeCheck('pending')],
      })
    )
    expect(badge).toEqual({ kind: 'ci-fail', label: 'CI ✗' })
  })

  test('only pending checks yields pending', () => {
    const badge = getPRBadge(
      makePRStatus({
        statusCheckRollup: [makeCheck('pass'), makeCheck('pending')],
      })
    )
    expect(badge).toEqual({ kind: 'pending', label: 'pending' })
  })

  test('all-pass checks with CHANGES_REQUESTED yields review', () => {
    const badge = getPRBadge(makePRStatus({ reviewDecision: 'CHANGES_REQUESTED' }))
    expect(badge).toEqual({ kind: 'review', label: 'review' })
  })

  test('all-pass checks with REVIEW_REQUIRED yields review', () => {
    const badge = getPRBadge(makePRStatus({ reviewDecision: 'REVIEW_REQUIRED' }))
    expect(badge).toEqual({ kind: 'review', label: 'review' })
  })

  test('all-pass checks with APPROVED yields ready', () => {
    const badge = getPRBadge(makePRStatus({ reviewDecision: 'APPROVED' }))
    expect(badge).toEqual({ kind: 'ready', label: '✓ klaar' })
  })

  test('all-pass checks without reviewDecision yields ready', () => {
    expect(getPRBadge(makePRStatus())).toEqual({ kind: 'ready', label: '✓ klaar' })
  })
})

describe('getPRBadge — unknown mergeability (right after a push)', () => {
  test('mergeable UNKNOWN with empty checks yields pending, not ready', () => {
    const badge = getPRBadge(makePRStatus({ mergeable: 'UNKNOWN', statusCheckRollup: [] }))
    expect(badge).toEqual({ kind: 'pending', label: 'pending' })
  })

  test('mergeable UNKNOWN with all-pass checks still yields pending', () => {
    const badge = getPRBadge(makePRStatus({ mergeable: 'UNKNOWN' }))
    expect(badge).toEqual({ kind: 'pending', label: 'pending' })
  })

  test('failing checks win over unknown mergeability', () => {
    const badge = getPRBadge(
      makePRStatus({
        mergeable: 'UNKNOWN',
        statusCheckRollup: [makeCheck('fail')],
      })
    )
    expect(badge).toEqual({ kind: 'ci-fail', label: 'CI ✗' })
  })
})

describe('getPRBadge — empty or missing check list', () => {
  test('empty statusCheckRollup follows the ready path without crashing', () => {
    expect(getPRBadge(makePRStatus({ statusCheckRollup: [] }))).toEqual({
      kind: 'ready',
      label: '✓ klaar',
    })
  })

  test('undefined statusCheckRollup follows the ready path without crashing', () => {
    expect(getPRBadge(makePRStatus({ statusCheckRollup: undefined }))).toEqual({
      kind: 'ready',
      label: '✓ klaar',
    })
  })

  test('empty checks with review blockade still yields review', () => {
    const badge = getPRBadge(
      makePRStatus({ statusCheckRollup: [], reviewDecision: 'REVIEW_REQUIRED' })
    )
    expect(badge).toEqual({ kind: 'review', label: 'review' })
  })
})

describe('shouldShowMergeButton — button hidden only for hard blocks', () => {
  test('mergeable MERGEABLE, open PR shows the button', () => {
    expect(shouldShowMergeButton(makePRStatus())).toBe(true)
  })

  test('CONFLICTING is the only mergeability that hides the button', () => {
    expect(shouldShowMergeButton(makePRStatus({ mergeable: 'CONFLICTING' }))).toBe(false)
  })

  test('UNKNOWN mergeability still shows the button (lazy compute after push)', () => {
    expect(shouldShowMergeButton(makePRStatus({ mergeable: 'UNKNOWN' }))).toBe(true)
  })

  test('absent mergeability shows the button (only CONFLICTING is a hard block)', () => {
    expect(shouldShowMergeButton(makePRStatus({ mergeable: undefined }))).toBe(true)
  })

  // Regression: a transient gh failure marks the row stale (PR #127). The badge
  // stays but the button must NOT disappear — the merge validates live via gh.
  test('stale row with mergeable data still shows the button', () => {
    expect(shouldShowMergeButton(makePRStatus({ stale: true }))).toBe(true)
  })

  test('stale + UNKNOWN still shows the button', () => {
    expect(shouldShowMergeButton(makePRStatus({ stale: true, mergeable: 'UNKNOWN' }))).toBe(true)
  })

  test('stale + CONFLICTING stays hidden', () => {
    expect(shouldShowMergeButton(makePRStatus({ stale: true, mergeable: 'CONFLICTING' }))).toBe(
      false
    )
  })

  test('no PR hides the button', () => {
    expect(shouldShowMergeButton(makePRStatus({ noPR: true }))).toBe(false)
  })

  test('undefined status hides the button', () => {
    expect(shouldShowMergeButton(undefined)).toBe(false)
  })

  test('CLOSED PR hides the button', () => {
    expect(shouldShowMergeButton(makePRStatus({ state: 'CLOSED' }))).toBe(false)
  })

  test('MERGED PR hides the button', () => {
    expect(shouldShowMergeButton(makePRStatus({ state: 'MERGED' }))).toBe(false)
  })
})
