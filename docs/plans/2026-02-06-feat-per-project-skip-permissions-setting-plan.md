---
title: Per-project dangerously-skip-permissions setting
type: feat
date: 2026-02-06
---

# Per-project dangerously-skip-permissions setting

## Overview

Add a per-project setting to launch Claude Code chats with `--dangerously-skip-permissions` (aka "YOLO mode"). When enabled for a project, all new Chat terminals in that project will run `claude --dangerously-skip-permissions` instead of plain `claude`.

## Problem Statement

Currently all Chat terminals spawn `claude` with no flags. Users who want autonomous Claude sessions must manually type `--dangerously-skip-permissions` each time. This is tedious for users who routinely work in containers or isolated environments.

## Proposed Solution

1. Add an optional `settings` object to the `Project` type with a `dangerouslySkipPermissions` boolean
2. Wire a new `project:update` IPC channel to persist settings
3. Modify `TerminalManager.createTerminal` to accept and use the flag
4. Fill in the "General" settings tab with per-project toggles

## Technical Approach

### Files to Change

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `ProjectSettings` interface, add `settings?` to `Project` |
| `electron/main/services/ProjectPersistence.ts` | Mirror type changes, bump `STATE_VERSION` to 4, add migration |
| `electron/main/index.ts` | Add `project:update` IPC handler, pass settings to `createTerminal` |
| `electron/preload/index.ts` | Expose `project.update` in `electronAPI` |
| `electron/main/services/TerminalManager.ts` | Add `dangerouslySkipPermissions` to `CreateTerminalOptions`, append flag to `claudeCommand` |
| `src/stores/projectStore.ts` | Add `updateProject` action, call IPC |
| `src/components/Settings/SettingsDialog.tsx` | Replace "General" placeholder with `GeneralSection` |
| `src/components/Settings/GeneralSection.tsx` | **New file** — per-project toggle UI |

### Phase 1: Data Model & Persistence

**`src/types/index.ts`** — Add settings to Project:

```ts
export interface ProjectSettings {
  dangerouslySkipPermissions?: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  type: ProjectType
  createdAt: number
  sortOrder: number
  settings?: ProjectSettings  // <-- new
}
```

**`electron/main/services/ProjectPersistence.ts`** — Mirror types, bump version:

```ts
// Duplicate ProjectSettings interface (process isolation)
interface ProjectSettings {
  dangerouslySkipPermissions?: boolean
}

// Add settings? to Project interface
interface Project {
  // ... existing fields ...
  settings?: ProjectSettings
}

// Bump STATE_VERSION from 3 to 4
const STATE_VERSION = 4

// Add migration from v3 to v4 (no-op, settings is optional)
```

The migration from v3 → v4 is trivial: `settings` is optional so existing projects need no data transformation.

**`src/types/index.ts`** — Add `update` to `ElectronAPI.project`:

```ts
project: {
  // ... existing ...
  update: (id: string, updates: Partial<Pick<Project, 'name' | 'settings'>>) => Promise<Project | null>
}
```

### Phase 2: IPC Wiring

**`electron/preload/index.ts`** — Expose update:

```ts
project: {
  // ... existing ...
  update: (id: string, updates: Record<string, unknown>): Promise<Project | null> =>
    ipcRenderer.invoke('project:update', id, updates),
}
```

**`electron/main/index.ts`** — Add handler:

```ts
ipcMain.handle('project:update', async (_event, id: string, updates: Record<string, unknown>) => {
  if (!isValidUUID(id)) throw new Error('Invalid project ID')
  // Whitelist allowed update fields
  const allowedUpdates: Record<string, unknown> = {}
  if (updates.settings && typeof updates.settings === 'object') {
    allowedUpdates.settings = updates.settings
  }
  if (typeof updates.name === 'string') {
    allowedUpdates.name = updates.name
  }
  return projectPersistence?.updateProject(id, allowedUpdates)
})
```

### Phase 3: Terminal Manager

**`electron/main/services/TerminalManager.ts`** — Accept flag:

```ts
export interface CreateTerminalOptions {
  // ... existing ...
  dangerouslySkipPermissions?: boolean  // <-- new
}
```

In `createTerminal`, modify the `claudeCommand` construction (line 136-138):

```ts
const flags: string[] = []
if (resumeSessionId) flags.push(`--resume "${resumeSessionId}"`)
if (options.dangerouslySkipPermissions) flags.push('--dangerously-skip-permissions')

const claudeCommand = `claude${flags.length ? ' ' + flags.join(' ') : ''}\r`
```

**`electron/main/index.ts`** — In the `terminal:create` handler, look up project settings and pass through:

```ts
const project = projects.find(p => p.id === projectId)
cwd = project?.path ?? process.cwd()
const dangerouslySkipPermissions = project?.settings?.dangerouslySkipPermissions ?? false

return terminalManager?.createTerminal({
  cwd,
  type,
  initialInput: effectiveInitialInput,
  initialTitle,
  projectId,
  worktreeId: worktreeId ?? undefined,
  dangerouslySkipPermissions,  // <-- new
})
```

### Phase 4: Zustand Store

**`src/stores/projectStore.ts`** — Add action:

```ts
updateProject: async (id: string, updates: Partial<Pick<Project, 'name' | 'settings'>>) => {
  const result = await window.electronAPI.project.update(id, updates)
  if (result) {
    // Re-fetch project list to sync state
    const projects = await window.electronAPI.project.list()
    set({ projects })
  }
}
```

### Phase 5: Settings UI

**`src/components/Settings/GeneralSection.tsx`** (new file):

- List all projects with a toggle switch for "Skip Permissions (YOLO mode)"
- Show a warning badge/text explaining the security implications
- Each toggle calls `updateProject(projectId, { settings: { dangerouslySkipPermissions: value } })`
- Only affects **new** chats; existing running chats are unaffected

**`src/components/Settings/SettingsDialog.tsx`** — Replace placeholder:

```tsx
{activeTab === 'general' && <GeneralSection />}
```

### UI Design

The General tab should show:

```
Project Settings
─────────────────────────────────────
[Project Name 1]
  ⚡ Skip Permissions (YOLO mode)  [toggle]
  ⚠️ Runs claude --dangerously-skip-permissions.
    Only use in isolated environments.

[Project Name 2]
  ⚡ Skip Permissions (YOLO mode)  [toggle]
  ...
```

## Acceptance Criteria

- [x] `Project` type has optional `settings.dangerouslySkipPermissions` field
- [x] `project:update` IPC handler persists settings to `projects.json`
- [x] State version bumped to 4 with backward-compatible migration
- [x] New chats in a project with the flag enabled launch with `claude --dangerously-skip-permissions`
- [x] New chats in a project without the flag launch with plain `claude`
- [x] Resumed sessions (`--resume`) also get the flag appended when enabled
- [x] Settings dialog "General" tab shows per-project toggle
- [x] Toggle includes security warning text
- [x] Existing running chats are not affected by toggling the setting

## Edge Cases

- **Migration**: Existing projects have no `settings` field → treated as `undefined` → flag off. No data migration needed beyond version bump.
- **Resumed sessions**: The `--resume` and `--dangerously-skip-permissions` flags can be combined: `claude --resume "id" --dangerously-skip-permissions`
- **Worktree terminals**: Worktrees inherit the parent project's setting since they share the same `projectId`
- **Normal terminals**: Only `claude` type terminals are affected; `normal` (shell) terminals are unchanged

## References

- CLI flag: `claude --dangerously-skip-permissions` ([Claude Code docs](https://code.claude.com/docs/en/cli-reference))
- Equivalent to `--permission-mode bypassPermissions`
- Current claude command construction: `electron/main/services/TerminalManager.ts:136-138`
- Settings dialog placeholder: `src/components/Settings/SettingsDialog.tsx:74-78`
- Project type definition: `src/types/index.ts:4-11`
- Project persistence: `electron/main/services/ProjectPersistence.ts`
