import type { NotchSession, Project, TerminalSession } from '../types'
import { isAgentType } from '@shared/agents'

/**
 * Derive the cross-project agent-session snapshot for the notch strip from the
 * store's flat terminals record. Plain 'normal' shells are excluded; every
 * agent chat (Claude/Codex/pi), across all projects and worktrees, is included
 * with its current state. Pure and testable — no store or IPC access.
 */
export function deriveNotchSessions(
  terminals: Record<string, TerminalSession>,
  projects: Project[],
): NotchSession[] {
  const nameById = new Map(projects.map((p) => [p.id, p.name]))
  const sessions: NotchSession[] = []
  for (const t of Object.values(terminals)) {
    if (!isAgentType(t.type)) continue
    sessions.push({
      id: t.id,
      projectId: t.projectId,
      projectName: nameById.get(t.projectId) ?? 'Unknown',
      title: t.generatedTitle || t.title || 'Untitled',
      agentType: t.type,
      state: t.state,
    })
  }
  return sessions
}
