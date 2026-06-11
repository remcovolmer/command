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

    expect(result.version).toBe(7)
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

    expect(result.version).toBe(7)
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

    expect(result.version).toBe(7)
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

    expect(result.version).toBe(7)
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

    expect(result.version).toBe(7)
    // First: true → full-auto
    expect(result.projects[0].settings.claudeMode).toBe('full-auto')
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
    // Second: false → no claudeMode
    expect(result.projects[1].settings).not.toHaveProperty('dangerouslySkipPermissions')
    expect(result.projects[1].settings).not.toHaveProperty('claudeMode')
    // Third: no settings → unchanged
    expect(result.projects[2]).not.toHaveProperty('settings')
  })

  test('chained migration: v4 state → reaches v7 via v4→v5→v6→v7', () => {
    const state = {
      version: 4,
      projects: [makeProject({ settings: { dangerouslySkipPermissions: true } })],
      worktrees: {},
      sessions: [],
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(7)
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

    expect(result.version).toBe(7)
    expect(result.projects[0].settings.claudeMode).toBe('full-auto')
    expect(result.projects[0].settings.authMode).toBe('profile')
    expect(result.projects[0].settings.profileId).toBe('some-profile-id')
    expect(result.projects[0].settings).not.toHaveProperty('dangerouslySkipPermissions')
  })
})

describe('ProjectPersistence v6→v7 migration (workspace type → pinned project)', () => {
  let persistence: ProjectPersistence

  beforeEach(() => {
    persistence = new ProjectPersistence()
  })

  test('workspace project → type project + pinned true', () => {
    const state = {
      version: 6,
      projects: [makeProject({ id: 'aaaa-ws', type: 'workspace' })],
      worktrees: {}, sessions: [], profiles: [], activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.version).toBe(7)
    expect(result.projects[0].type).toBe('project')
    expect(result.projects[0].pinned).toBe(true)
  })

  test('non-workspace projects keep their type and are not auto-pinned', () => {
    const state = {
      version: 6,
      projects: [
        makeProject({ id: 'aaaa-code', type: 'code' }),
        makeProject({ id: 'aaaa-proj', type: 'project' }),
      ],
      worktrees: {}, sessions: [], profiles: [], activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.projects[0].type).toBe('code')
    expect(result.projects[0].pinned).toBeUndefined()
    expect(result.projects[1].type).toBe('project')
    expect(result.projects[1].pinned).toBeUndefined()
  })

  test('migrated workspace preserves name, path, and settings', () => {
    const state = {
      version: 6,
      projects: [makeProject({
        id: 'aaaa-ws', type: 'workspace', name: 'Docs', path: '/docs',
        settings: { claudeMode: 'chat' },
      })],
      worktrees: {}, sessions: [], profiles: [], activeProfileId: null,
    }

    const result = callMigrateState(persistence, state)

    expect(result.projects[0].name).toBe('Docs')
    expect(result.projects[0].path).toBe('/docs')
    expect(result.projects[0].settings).toEqual({ claudeMode: 'chat' })
  })

  test('idempotent: an already-pinned project survives a re-run unchanged', () => {
    // A v7 state fed back through migrateState hits the default fallthrough and
    // never re-enters the v6→v7 transform, so pins are not flipped or duplicated.
    const migrated = callMigrateState(persistence, {
      version: 6,
      projects: [makeProject({ id: 'aaaa-ws', type: 'workspace' })],
      worktrees: {}, sessions: [], profiles: [], activeProfileId: null,
    })

    const rerun = callMigrateState(persistence, migrated)

    expect(rerun.version).toBe(7)
    expect(rerun.projects[0].type).toBe('project')
    expect(rerun.projects[0].pinned).toBe(true)
  })
})
