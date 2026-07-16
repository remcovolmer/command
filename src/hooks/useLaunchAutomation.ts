import { useCallback, useMemo } from 'react'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import type { Automation, AutomationTarget, TerminalSession } from '../types'

/**
 * Foreground-launch an automation: spawn an interactive chat (optionally inside
 * a fresh worktree) in the automation's project, with the automation's prompt
 * submitted via `claude "<prompt>"`.
 *
 * Focus-neutral by design (R21): the spawned session is registered in the
 * sidebar with `origin: 'automation'` but the active project/terminal are NOT
 * changed — a launch (manual or, later, triggered) must never yank the user
 * away from what they're doing. The main process logs the launch as a
 * foreground run linked to the terminal (link-back for the overview).
 */
export function useLaunchAutomation() {
  const api = useMemo(() => getElectronAPI(), [])
  const addTerminal = useProjectStore((s) => s.addTerminal)
  const addWorktree = useProjectStore((s) => s.addWorktree)
  const removeWorktree = useProjectStore((s) => s.removeWorktree)

  const launch = useCallback(
    async (
      automation: Automation,
      overrideTarget?: AutomationTarget
    ): Promise<string | null> => {
      const target = overrideTarget ?? automation.defaultTarget
      const { projectId } = automation

      // Worktrees need a Git repo; only Code-type projects have one.
      const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
      if (target === 'worktree' && project?.type !== 'code') {
        api.notification.show(
          'Automation',
          `"${automation.name}": worktree launches need a Git project. Set its target to "Chat in project".`
        )
        return null
      }

      // Enforce the per-project terminal cap. Count exactly what useCreateTerminal
      // counts (every terminal in the project) so both entry points enforce the
      // same MAX_TERMINALS_PER_PROJECT limit and can't drift.
      const currentTerminals = useProjectStore.getState().terminals
      const projectTerminalCount = Object.values(currentTerminals).filter(
        (t) => t.projectId === projectId
      ).length
      if (projectTerminalCount >= MAX_TERMINALS_PER_PROJECT) {
        api.notification.show(
          'Chat Limit',
          `Maximum ${MAX_TERMINALS_PER_PROJECT} chats per project`
        )
        return null
      }

      let worktreeId: string | undefined
      let worktreeBranch: string | undefined
      let title: string

      if (target === 'worktree') {
        // A persistent worktree on a fresh branch — not a headless throwaway.
        const slug =
          automation.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 24) || 'automation'
        const suffix = Date.now().toString(36).slice(-5)
        const branchName = `automation/${slug}-${suffix}`

        try {
          const worktree = await api.worktree.create(
            projectId,
            branchName,
            undefined,
            automation.baseBranch || undefined
          )
          addWorktree(worktree)
          worktreeId = worktree.id
          worktreeBranch = worktree.branch
          title = worktree.name
        } catch (err) {
          api.notification.show(
            'Automation',
            `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`
          )
          return null
        }
      } else {
        title = automation.name
      }

      // If the chat fails to spawn after a worktree was created, don't leak it —
      // remove the worktree so a failed launch doesn't leave an empty,
      // terminal-less worktree in the sidebar and on disk.
      const cleanupOrphanWorktree = () => {
        if (!worktreeId) return
        api.worktree.remove(worktreeId, false).catch(() => {})
        removeWorktree(worktreeId)
      }

      let terminalId: string | null
      try {
        terminalId = await api.terminal.create(
          projectId,
          worktreeId,
          'claude',
          undefined,
          automation.prompt
        )
      } catch {
        cleanupOrphanWorktree()
        api.notification.show('Automation', 'Failed to launch chat')
        return null
      }
      if (!terminalId) {
        cleanupOrphanWorktree() // spawn-failed toast already surfaced
        return null
      }

      const terminal: TerminalSession = {
        id: terminalId,
        projectId,
        worktreeId: worktreeId ?? null,
        state: 'busy',
        lastActivity: Date.now(),
        title,
        type: 'claude',
        origin: 'automation',
      }
      // activate:false → do not switch focus (R21). It shows in the sidebar.
      addTerminal(terminal, { activate: false })

      // Log the launch into the shared run-history timeline (best-effort).
      api.automation.recordLaunch(automation.id, { terminalId, worktreeBranch }).catch(() => {})

      return terminalId
    },
    [api, addTerminal, addWorktree, removeWorktree]
  )

  return { launch }
}
