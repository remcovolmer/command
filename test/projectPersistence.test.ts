import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

// Mock fs modules to avoid disk I/O
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}))

import { ProjectPersistence } from '../electron/main/services/ProjectPersistence'

// Access the private migrateState method for direct testing
function callMigrateState(instance: ProjectPersistence, state: Record<string, unknown>) {
  return (instance as any).migrateState(state)
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Test Project',
    path: '/test/project',
    type: 'code',
    createdAt: Date.now(),
    sortOrder: 0,
    ...overrides,
  }
}

describe('ProjectPersistence v5→v6 migration', () => {
  let persistence: ProjectPersistence

  beforeEach(() => {
    persistence = new ProjectPersistence()
  })

  test('dangerouslySkipPermissions: true → claudeMode: full-auto, old key removed', () => {
    const state = {
      version: 5,
      projects: [makeProject({ settings: { dangerouslySkipPermissions: true } })],
      worktrees: {},
      sessions: [],
      profiles: [],
      activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    expect(result.projects[0].settings.claudeMode).toBe('full-auto')
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
  })

  test('dangerouslySkipPermissions: false → old key removed, no claudeMode set', () => {
    const state = {
      version: 5,
      projects: [makeProject({ settings: { dangerouslySkipPermissions: false } })],
      worktrees: {},
      sessions: [],
      profiles: [],
      activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
    expect(result.projects[0].settings).not.toHaveProperty('claudeMode')
  })

  test('project with no settings → returned unchanged', () => {
    const state = {
      version: 5,
      projects: [makeProject()],
      worktrees: {},
      sessions: [],
      profiles: [],
      activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    expect(result.projects[0]).not.toHaveProperty('settings')
  })

  test('dangerouslySkipPermissions: undefined but key present → old key removed', () => {
    const state = {
      version: 5,
      projects: [makeProject({ settings: { dangerouslySkipPermissions: undefined } })],
      worktrees: {},
      sessions: [],
      profiles: [],
      activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
    expect(result.projects[0].settings).not.toHaveProperty('claudeMode')
  })

  test('multiple projects: mix of true/false/absent → each migrated correctly', () => {
    const state = {
      version: 5,
      projects: [
        makeProject({ id: 'aaaa-1', settings: { dangerouslySkipPermissions: true } }),
        makeProject({ id: 'aaaa-2', settings: { dangerouslySkipPermissions: false } }),
        makeProject({ id: 'aaaa-3' }), // no settings at all
      ],
      worktrees: {},
      sessions: [],
      profiles: [],
      activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    // First: true → full-auto
    expect(result.projects[0].settings.claudeMode).toBe('full-auto')
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
    // Second: false → no claudeMode
    expect(result.projects[1].settings).not.toHaveProperty('dangerouslySkipPermissions')
    expect(result.projects[1].settings).not.toHaveProperty('claudeMode')
    // Third: no settings → unchanged
    expect(result.projects[2]).not.toHaveProperty('settings')
  })

  test('chained migration: v4 state → reaches v6 via v4→v5→v6', () => {
    const state = {
      version: 4,
      projects: [makeProject({ settings: { dangerouslySkipPermissions: true } })],
      worktrees: {},
      sessions: [],
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    expect(result.projects[0].settings.claudeMode).toBe('full-auto')
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
    // v4→v5 adds profiles and activeProfileId
    expect(result.profiles).toEqual([])
    expect(result.activeProfileId).toBeNull()
  })

  test('other settings preserved alongside migration', () => {
    const state = {
      version: 5,
      projects: [makeProject({
        settings: {
          authMode: 'profile',
          profileId: 'some-profile-id',
          dangerouslySkipPermissions: true,
        },
      })],
      worktrees: {},
      sessions: [],
      profiles: [],
      activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(6)
    expect(result.projects[0].settings.claudeMode).toBe('full-auto')
    expect(result.projects[0].settings.authMode).toBe('profile')
    expect(result.projects[0].settings.profileId).toBe('some-profile-id')
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
  })
})
