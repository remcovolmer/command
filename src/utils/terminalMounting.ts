import type { TerminalSession } from '../types'

/**
 * All chat terminals across every project, in store insertion order.
 *
 * TerminalArea keeps every chat mounted (hidden unless active) so project
 * switches and overviews never unmount a live xterm. Insertion order — not
 * the per-project tab order — keeps React from moving xterm DOM nodes around
 * when worktrees load or tabs regroup (a moved scroll container loses its
 * scroll position). Same chat filter as getVisibleTerminals.
 */
export function getMountedChats(
  terminals: Record<string, TerminalSession>,
  sidecarTerminals: Record<string, string[]>
): TerminalSession[] {
  const sidecarIds = new Set(Object.values(sidecarTerminals).flat())
  return Object.values(terminals).filter((t) => t.type !== 'normal' && !sidecarIds.has(t.id))
}

/**
 * The chat that is really on screen: the active terminal, but only when it
 * belongs to the active project and no overview covers the chat column.
 * Anything else must not receive focus, fit or active-terminal pool protection.
 */
export function getViewportActiveTerminalId(
  terminals: Record<string, TerminalSession>,
  activeTerminalId: string | null,
  activeProjectId: string | null,
  chatsVisible: boolean
): string | null {
  if (!chatsVisible || !activeTerminalId || !activeProjectId) return null
  return terminals[activeTerminalId]?.projectId === activeProjectId ? activeTerminalId : null
}
