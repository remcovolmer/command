/**
 * Extracted `restoreSessions` body.
 *
 * Lives in its own module so unit tests can exercise the per-session loop —
 * particularly the spawn-failure-skip path — without booting Electron.
 */

import { isSpawnError } from '../services/errors'
import { createLogger } from '../services/Logger'
import type { TerminalManager } from '../services/TerminalManager'
import type { ProjectPersistence } from '../services/ProjectPersistence'
import type { ClaudeHookWatcher } from '../services/ClaudeHookWatcher'
import type { BrowserWindow } from 'electron'
import type { AgentType } from '../../../shared/ipc-types'

const log = createLogger('Session')

export interface RestoreSessionsDeps {
  projectPersistence: ProjectPersistence | null
  terminalManager: TerminalManager | null
  hookWatcher: ClaudeHookWatcher | null
  getWindow: () => BrowserWindow | null
  verifyAgentSession: (agentType: AgentType, cwd: string, sessionId: string) => Promise<boolean>
  pathExists: (p: string) => Promise<boolean>
  resolveEnvOverrides: (
    project: { settings?: { authMode?: string; profileId?: string } } | undefined
  ) => Record<string, string> | undefined
}

export async function restoreSessions(deps: RestoreSessionsDeps): Promise<void> {
  const {
    projectPersistence,
    terminalManager,
    hookWatcher,
    getWindow,
    verifyAgentSession,
    pathExists,
    resolveEnvOverrides,
  } = deps
  const win = getWindow()
  if (!projectPersistence || !terminalManager || !win) {
    log.info('Cannot restore: services not initialized')
    return
  }

  const sessions = projectPersistence.getSessions()
  if (sessions.length === 0) {
    log.info('No sessions to restore')
    return
  }

  log.info(`Attempting to restore ${sessions.length} sessions`)

  const projects = projectPersistence.getProjects()
  const projectMap = new Map(projects.map((p) => [p.id, p]))

  // Pre-validate all sessions in parallel for better performance
  const validationResults = await Promise.all(
    sessions.map(async (session) => {
      const project = projectMap.get(session.projectId)
      if (!project) {
        return {
          session,
          valid: false as const,
          reason: `project ${session.projectId} no longer exists`,
        }
      }

      if (session.worktreeId) {
        const worktree = projectPersistence.getWorktreeById(session.worktreeId)
        if (!worktree) {
          return {
            session,
            valid: false as const,
            reason: `worktree ${session.worktreeId} no longer exists`,
          }
        }
        const worktreeExists = await pathExists(worktree.path)
        if (!worktreeExists) {
          return {
            session,
            valid: false as const,
            reason: `worktree path ${worktree.path} no longer exists`,
          }
        }
      }

      const cwdExists = await pathExists(session.cwd)
      if (!cwdExists) {
        return { session, valid: false as const, reason: `cwd ${session.cwd} no longer exists` }
      }

      const agentType: AgentType = session.agentType ?? 'claude'
      const sessionFileExists = await verifyAgentSession(
        agentType,
        session.cwd,
        session.claudeSessionId
      )

      return { session, project, valid: true as const, sessionFileExists, agentType }
    })
  )

  for (const result of validationResults) {
    if (!result.valid) {
      log.info(`Skipping session: ${result.reason}`)
      continue
    }

    const { session, project, sessionFileExists, agentType } = result

    try {
      if (!sessionFileExists) {
        log.info(`Session file not found for ${session.claudeSessionId}, starting fresh`)
      }

      const envOverrides = resolveEnvOverrides(project)

      const terminalId = terminalManager.createTerminal({
        cwd: session.cwd,
        type: agentType,
        initialTitle: session.title || undefined,
        projectId: session.projectId,
        worktreeId: session.worktreeId ?? undefined,
        resumeSessionId: sessionFileExists ? session.claudeSessionId : undefined,
        claudeMode: project?.settings?.claudeMode,
        envOverrides,
      })

      if (sessionFileExists && hookWatcher) {
        hookWatcher.preAssociateSession(session.claudeSessionId, terminalId)
      }

      log.info(`Restored terminal ${terminalId} for session ${session.claudeSessionId}`)

      win.webContents.send('session:restored', {
        terminalId,
        projectId: session.projectId,
        worktreeId: session.worktreeId,
        title: session.title,
        summary: session.summary,
      })
    } catch (error) {
      if (isSpawnError(error)) {
        // Restore-time spawn failures are silent: log the cause and skip the
        // session. We do NOT modal-bomb the user during startup for stale
        // worktrees — those projects show up missing in the sidebar anyway.
        log.warn(`Skipping session ${session.claudeSessionId}: ${error.code} for cwd ${error.cwd}`)
      } else {
        log.error(`Failed to restore session:`, error)
      }
    }
  }

  projectPersistence.clearSessions()
  log.info('Restoration complete, cleared persisted sessions')
}
