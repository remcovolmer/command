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
 *
 * All terminal reads use getState() to avoid stale closures across awaits.
 */
export function useCreateTerminal() {
  const api = useMemo(() => getElectronAPI(), [])
  const addTerminal = useProjectStore((s) => s.addTerminal)
  const setActiveTerminal = useProjectStore((s) => s.setActiveTerminal)

  const createTerminal = useCallback(
    async (projectId: string, options?: CreateTerminalOptions) => {
      const { worktreeId, onCreated } = options ?? {}

      // Always read fresh state to avoid stale closures
      const currentTerminals = () => useProjectStore.getState().terminals

      // Enforce 1:1 worktree-terminal coupling
      if (worktreeId) {
        const existing = Object.values(currentTerminals()).find((t) => t.worktreeId === worktreeId)
        if (existing) {
          setActiveTerminal(existing.id)
          return existing.id
        }
      }

      // Check terminal limit (max per project)
      const projectTerminals = Object.values(currentTerminals()).filter(
        (t) => t.projectId === projectId
      )
      if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
        api.notification.show(
          'Chat Limit',
          `Maximum ${MAX_TERMINALS_PER_PROJECT} chats per project`
        )
        return null
      }

      let terminalId: string
      try {
        terminalId = await api.terminal.create(projectId, worktreeId)
      } catch {
        api.notification.show('Error', 'Failed to create terminal')
        return null
      }

      // Re-read state after await — terminals may have changed
      const freshTerminals = currentTerminals()

      // For worktree terminals, use the worktree name as the tab title
      const worktree = worktreeId
        ? Object.values(useProjectStore.getState().worktrees).find((w) => w.id === worktreeId)
        : null

      const title = worktree
        ? worktree.name
        : `Chat ${Object.values(freshTerminals).filter((t) => t.projectId === projectId && t.worktreeId === null).length + 1}`

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
    [api, addTerminal, setActiveTerminal]
  )

  return { createTerminal }
}
