import { describe, test, expect } from 'vitest'
import { getPRBadge } from '../src/utils/prBadge'
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
