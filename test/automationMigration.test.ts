import { describe, test, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata-migration'),
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

const mockFs = vi.mocked(fs)

/** Make the constructor read the given v1 state from the two JSON files. */
function seedFiles(automations: unknown, runs: unknown) {
  mockFs.existsSync.mockReturnValue(true)
  const impl = (p: unknown): string => {
    const s = String(p)
    return s.includes('automation-runs') ? JSON.stringify(runs) : JSON.stringify(automations)
  }
  mockFs.readFileSync.mockImplementation(impl as unknown as typeof fs.readFileSync)
}

describe('AutomationPersistence v1 → v2 migration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('collapses projectIds[] to the first projectId and defaults target to worktree', () => {
    seedFiles(
      {
        version: 1,
        automations: [
          {
            id: 'a1',
            name: 'PR triage',
            prompt: 'review',
            projectIds: ['proj-A', 'proj-B'],
            trigger: { type: 'schedule', cron: '0 9 * * *' },
            enabled: true,
            timeoutMinutes: 30,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      },
      { version: 1, runs: [] }
    )

    const p = new AutomationPersistence()
    const [a] = p.getAutomations()

    expect(a.projectId).toBe('proj-A')
    expect((a as unknown as { projectIds?: unknown }).projectIds).toBeUndefined()
    expect(a.defaultTarget).toBe('worktree')
    expect(a.enabled).toBe(true)
  })

  test('disables an automation that had no associated projects', () => {
    seedFiles(
      {
        version: 1,
        automations: [
          {
            id: 'a2',
            name: 'orphan',
            prompt: 'x',
            projectIds: [],
            trigger: { type: 'claude-done' },
            enabled: true,
            timeoutMinutes: 30,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      },
      { version: 1, runs: [] }
    )

    const p = new AutomationPersistence()
    const [a] = p.getAutomations()

    expect(a.projectId).toBe('')
    expect(a.enabled).toBe(false)
  })

  test('marks pre-existing runs as headless', () => {
    seedFiles(
      { version: 1, automations: [] },
      {
        version: 1,
        runs: [
          {
            id: 'r1',
            automationId: 'a1',
            projectId: 'proj-A',
            status: 'completed',
            startedAt: '2026-01-01T00:00:00.000Z',
            read: true,
          },
        ],
      }
    )

    const p = new AutomationPersistence()
    const [r] = p.getRuns()

    expect(r.mode).toBe('headless')
  })

  test('preserves an explicit defaultTarget when already present', () => {
    seedFiles(
      {
        version: 1,
        automations: [
          {
            id: 'a3',
            name: 'lint',
            prompt: 'x',
            projectIds: ['proj-A'],
            defaultTarget: 'chat',
            trigger: { type: 'schedule', cron: '0 9 * * *' },
            enabled: true,
            timeoutMinutes: 30,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
      },
      { version: 1, runs: [] }
    )

    const p = new AutomationPersistence()
    const [a] = p.getAutomations()

    expect(a.defaultTarget).toBe('chat')
  })
})
