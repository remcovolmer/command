---
title: Add "Open on GitHub" context menu option to project sidebar
problem_type: feature-implementation
component: sidebar-context-menu
tags: [electron, ipc, git, context-menu, github]
severity: low
date_solved: 2026-02-10
symptoms:
  - Users could not quickly navigate to GitHub repository from project context menu
  - Only "Open in File Explorer" and "Open in Antigravity" options existed
root_cause: Feature was not yet implemented
architecture: electron-ipc-renderer
---

# Add "Open on GitHub" Context Menu to Project Sidebar

## Problem

Code projects in the sidebar had no way to quickly open the repository on GitHub. Users had to manually navigate to the GitHub URL or use the terminal.

## Approach

The solution follows the app's established 4-layer IPC pattern:

1. **Service Layer** (`GitService`) - Detects and normalizes remote URLs
2. **Main Process IPC** - Handler validates path, delegates to service
3. **Preload Bridge** - Securely exposes the API to the renderer
4. **UI Layer** - Context menu conditionally shows for code projects only

This reuses the existing `shell.openExternal()` IPC endpoint which already enforces HTTPS-only URL validation, providing defense-in-depth.

## Implementation

### GitService - URL retrieval and normalization

```typescript
// electron/main/services/GitService.ts
async getRemoteUrl(projectPath: string): Promise<string | null> {
  try {
    const url = await this.execGit(projectPath, ['config', '--get', 'remote.origin.url'])
    if (!url) return null
    return this.normalizeGitUrl(url)
  } catch {
    return null
  }
}

private normalizeGitUrl(url: string): string {
  // SCP-like SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`
  }
  // URL-style SSH: ssh://git@github.com/owner/repo.git
  const sshUrlMatch = url.match(/^ssh:\/\/[^@]+@([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshUrlMatch) {
    return `https://${sshUrlMatch[1]}/${sshUrlMatch[2]}`
  }
  // HTTPS format: https://github.com/owner/repo.git
  return url.replace(/\.git$/, '')
}
```

### IPC handler

```typescript
// electron/main/index.ts
ipcMain.handle('git:get-remote-url', async (_event, projectPath: string) => {
  validateProjectPath(projectPath)
  return gitService?.getRemoteUrl(projectPath) ?? null
})
```

### Preload bridge

```typescript
// electron/preload/index.ts
getRemoteUrl: (projectPath: string): Promise<string | null> =>
  ipcRenderer.invoke('git:get-remote-url', projectPath),
```

### Context menu item

```typescript
// src/components/Sidebar/SortableProjectItem.tsx
...(project.type === 'code' ? [{
  label: 'Open on GitHub',
  onClick: async () => {
    try {
      const url = await getElectronAPI().git.getRemoteUrl(project.path)
      if (url) {
        await getElectronAPI().shell.openExternal(url)
      }
    } catch {
      // Remote URL unavailable or invalid
    }
  },
}] : []),
```

## Review Fixes

Two issues caught during code review before push:

1. **Missing `ssh://` URL format** - The initial `normalizeGitUrl()` only handled SCP-like SSH (`git@host:owner/repo.git`). URL-style SSH (`ssh://git@host/repo.git`) would fall through and be rejected by the HTTPS-only check in `shell:open-external`. Added a second regex branch.

2. **Missing `try/catch` on async handler** - The context menu `onClick` was an async function without error handling, risking unhandled promise rejections if `getRemoteUrl` or `openExternal` threw. Wrapped in try/catch.

## Security

- `execFile` (not `exec`) with hardcoded argument array prevents command injection
- `validateProjectPath()` checks type, non-empty, max length
- `shell:open-external` enforces `^https?://` protocol validation as final security gate
- Regex patterns are linear complexity (no ReDoS risk)
- Non-HTTPS remotes (`file://`, `git://`) are safely rejected by the protocol check

## Prevention & Best Practices

### IPC endpoint checklist

When adding a new IPC endpoint in this codebase:

1. Add method to the service class (`electron/main/services/`)
2. Add IPC handler in `electron/main/index.ts` with `validateProjectPath()` or equivalent
3. Expose in `electron/preload/index.ts` via the appropriate namespace
4. Update `ElectronAPI` type in `src/types/index.ts`
5. Consume via `getElectronAPI()` in the renderer

### Context menu additions

- Use the spread pattern `...(condition ? [item] : [])` for conditional items
- Async `onClick` handlers must have `try/catch`
- Test with missing/invalid data (no remote, non-git directory)

### Git URL normalization edge cases

| Format | Example | Handled |
|--------|---------|---------|
| SCP-like SSH | `git@github.com:owner/repo.git` | Yes |
| URL-style SSH | `ssh://git@github.com/owner/repo.git` | Yes |
| HTTPS | `https://github.com/owner/repo.git` | Yes |
| HTTPS (no .git) | `https://github.com/owner/repo` | Yes |
| `git://` protocol | `git://github.com/owner/repo.git` | Rejected by openExternal |
| `file://` protocol | `file:///local/path` | Rejected by openExternal |

## Related

- [Terminal Link Feature Review](../code-review/terminal-link-feature-review-fixes.md) - Documents `shell:open-external` IPC pattern and URL security
- [Editor Save Handler](../logic-errors/editor-save-handler-double-fire-and-isactive-propagation.md) - Multi-layer event flow patterns
- `CLAUDE.md` - Architecture reference for IPC communication patterns
- Commit: `e8c5a01` on `main`
