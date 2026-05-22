import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}))

import { AutomationPersistence } from '../electron/main/services/AutomationPersistence'

const MAX_RUNS_PER_AUTOMATION = 50

function addCompletedRun(p: AutomationPersistence, automationId: string, startedAt: string) {
  return p.addRun({
    automationId,
    projectId: 'project-1',
    status: 'completed',
    startedAt,
    read: false,
  })
}

describe('AutomationPersistence.pruneRuns', () => {
  let persistence: AutomationPersistence

  beforeEach(() => {
    persistence = new AutomationPersistence()
  })

  test('preserves an old running run when terminal-state runs exceed the cap', () => {
    const automationId = 'automation-1'

    // Seed an old running run from "yesterday" — this is the case the bug hits:
    // a long-lived run whose later updateRun() must still find it.
    const oldRunning = persistence.addRun({
      automationId,
      projectId: 'project-1',
      status: 'running',
      startedAt: '2026-05-21T00:00:00.000Z',
      read: false,
    })

    // Add MAX_RUNS_PER_AUTOMATION + 5 newer completed runs that would normally
    // push the oldest entry out of the window.
    const baseTime = new Date('2026-05-22T00:00:00.000Z').getTime()
    for (let i = 0; i < MAX_RUNS_PER_AUTOMATION + 5; i++) {
      addCompletedRun(persistence, automationId, new Date(baseTime + i * 1000).toISOString())
    }

    // The running run must still be retrievable.
    const stillThere = persistence.getRun(oldRunning.id)
    expect(stillThere).not.toBeNull()
    expect(stillThere?.status).toBe('running')

    // updateRun on the running run must succeed (it would return null if pruned).
    const updated = persistence.updateRun(oldRunning.id, { status: 'completed' })
    expect(updated).not.toBeNull()
    expect(updated?.status).toBe('completed')
  })

  test('still caps terminal-state runs at MAX_RUNS_PER_AUTOMATION', () => {
    const automationId = 'automation-2'
    const baseTime = new Date('2026-05-22T00:00:00.000Z').getTime()

    for (let i = 0; i < MAX_RUNS_PER_AUTOMATION + 10; i++) {
      addCompletedRun(persistence, automationId, new Date(baseTime + i * 1000).toISOString())
    }

    const runs = persistence.getRuns(automationId)
    // No running runs in this test, so total kept equals the cap.
    expect(runs.length).toBe(MAX_RUNS_PER_AUTOMATION)
    // Newest 50 are kept — oldest startedAt in the kept set should be index 10 of inserts.
    const expectedOldestKept = new Date(baseTime + 10 * 1000).toISOString()
    const oldestKept = runs[runs.length - 1].startedAt
    expect(oldestKept).toBe(expectedOldestKept)
  })

  test('prunes per automation independently', () => {
    const baseTime = new Date('2026-05-22T00:00:00.000Z').getTime()

    for (let i = 0; i < MAX_RUNS_PER_AUTOMATION + 5; i++) {
      addCompletedRun(persistence, 'automation-a', new Date(baseTime + i * 1000).toISOString())
    }
    for (let i = 0; i < 3; i++) {
      addCompletedRun(persistence, 'automation-b', new Date(baseTime + i * 1000).toISOString())
    }

    expect(persistence.getRuns('automation-a').length).toBe(MAX_RUNS_PER_AUTOMATION)
    expect(persistence.getRuns('automation-b').length).toBe(3)
  })
})
