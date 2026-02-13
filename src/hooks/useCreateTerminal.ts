import { useCallback, useMemo } from 'react'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import type { TerminalSession } from '../types'

interface CreateTerminalOptions {
  worktreeId?: string
  /** Called after the terminal is created and added to the store */
  onCreated?: (terminalId: string) => void
}

/**
 * Shared hook that encapsulates terminal creation logic.
 *
 * Handles:
 * - Worktree-terminal 1:1 coupling (selects existing terminal if one exists)
 * - Terminal count limit per project
 * - IPC call to create the PTY
 * - Adding the TerminalSession to the store
 */
export function useCreateTerminal() {
  const api = useMemo(() => getElectronAPI(), [])
  const terminals = useProjectStore((s) => s.terminals)
  const addTerminal = useProjectStore((s) => s.addTerminal)
  const setActiveTerminal = useProjectStore((s) => s.setActiveTerminal)

  const createTerminal = useCallback(
    async (projectId: string, options?: CreateTerminalOptions) => {
      const { worktreeId, onCreated } = options ?? {}

      // Enforce 1:1 worktree-terminal coupling
      if (worktreeId) {
        const existing = Object.values(terminals).find((t) => t.worktreeId === worktreeId)
        if (existing) {
          // Already has a terminal - just select it
          setActiveTerminal(existing.id)
          return existing.id
        }
      }

      // Check terminal limit (max per project)
      const projectTerminals = Object.values(terminals).filter(
        (t) => t.projectId === projectId
      )
      if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
        api.notification.show(
          'Chat Limit',
          `Maximum ${MAX_TERMINALS_PER_PROJECT} chats per project`
        )
        return null
      }

      const terminalId = await api.terminal.create(projectId, worktreeId)

      // For worktree terminals, use the worktree name as the tab title
      // Use getState() to read fresh worktrees (closure may be stale after addWorktree)
      const worktree = worktreeId
        ? Object.values(useProjectStore.getState().worktrees).find((w) => w.id === worktreeId)
        : null

      const title = worktree
        ? worktree.name
        : `Chat ${Object.values(terminals).filter((t) => t.projectId === projectId && t.worktreeId === null).length + 1}`

      const terminal: TerminalSession = {
        id: terminalId,
        projectId,
        worktreeId: worktreeId ?? null,
        state: 'busy',
        lastActivity: Date.now(),
        title,
        type: 'claude',
      }
      addTerminal(terminal)

      onCreated?.(terminalId)

      return terminalId
    },
    [api, terminals, addTerminal, setActiveTerminal]
  )

  return { createTerminal }
}
