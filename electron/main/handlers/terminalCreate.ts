/**
 * Extracted `terminal:create` IPC handler body.
 *
 * Lives in its own module so unit tests can exercise the spawn-failure /
 * success branches without booting Electron. The main process composes the
 * dependencies and registers the handler in electron/main/index.ts.
 */

import { isSpawnError } from '../services/errors'
import type { TerminalManager } from '../services/TerminalManager'
import type { ProjectPersistence } from '../services/ProjectPersistence'
import type { CrashLogger } from '../services/CrashLogger'
import type { BrowserWindow } from 'electron'

export interface TerminalCreateDeps {
  terminalManager: TerminalManager | null
  projectPersistence: ProjectPersistence | null
  crashLogger: CrashLogger
  getWindow: () => BrowserWindow | null
  resolveEnvOverrides: (project: { settings?: { authMode?: string; profileId?: string } } | undefined) => Record<string, string> | undefined
  isValidUUID: (id: string) => boolean
}

export interface TerminalCreateArgs {
  projectId: string
  worktreeId?: string
  type?: 'claude' | 'normal'
  resumeSessionId?: string
}

/**
 * Handler body. Returns the new terminal id on success, or `null` when the
 * spawn failed cleanly and the renderer was notified via `terminal:spawn-failed`.
 * Throws for validation errors and any non-spawn errors (kept as IPC rejection).
 */
export async function handleTerminalCreate(
  deps: TerminalCreateDeps,
  args: TerminalCreateArgs,
): Promise<string | null> {
  const { projectId, worktreeId, type = 'claude', resumeSessionId } = args
  const { terminalManager, projectPersistence, crashLogger, getWindow, resolveEnvOverrides, isValidUUID } = deps

  if (!isValidUUID(projectId)) {
    throw new Error('Invalid project ID')
  }
  if (worktreeId && !isValidUUID(worktreeId)) {
    throw new Error('Invalid worktree ID')
  }
  if (type !== undefined && type !== 'claude' && type !== 'normal') {
    throw new Error('Invalid terminal type')
  }
  if (resumeSessionId !== undefined && (typeof resumeSessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(resumeSessionId))) {
    throw new Error('Invalid session ID format')
  }

  // Look up project for settings and path
  const projects = projectPersistence?.getProjects() ?? []
  const project = projects.find(p => p.id === projectId)

  // Determine the working directory and initial title
  let cwd: string
  let initialTitle: string | undefined

  if (worktreeId) {
    const worktree = projectPersistence?.getWorktreeById(worktreeId)
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`)
    }
    cwd = worktree.path
    initialTitle = worktree.name
  } else {
    cwd = project?.path ?? process.cwd()
  }

  const envOverrides = resolveEnvOverrides(project)

  try {
    return terminalManager?.createTerminal({
      cwd,
      type,
      initialTitle,
      projectId,
      worktreeId: worktreeId ?? undefined,
      resumeSessionId: resumeSessionId ?? undefined,
      claudeMode: project?.settings?.claudeMode,
      envOverrides,
    }) ?? null
  } catch (error) {
    // Convert SpawnError into a non-throwing, renderer-visible event so the
    // user gets an inline toast instead of an unhandled IPC rejection or the
    // Electron "JavaScript error in main process" dialog. Other errors keep
    // their existing throw path.
    if (isSpawnError(error)) {
      // Log the underlying cause so the toast's "Open crash.log" button surfaces
      // the actual ENOENT / EACCES / native-pty failure instead of just the
      // SpawnError wrapper.
      const causeForLog = (error as Error & { cause?: unknown }).cause ?? error
      crashLogger.log(causeForLog, 'spawnFailed')
      const win = getWindow()
      win?.webContents.send('terminal:spawn-failed', {
        projectId,
        worktreeId,
        code: error.code,
        cwd: error.cwd,
        message: error.message,
      })
      console.warn(`[Terminal] Spawn failed: ${error.code} for cwd ${error.cwd}`)
      return null
    }
    throw error
  }
}
