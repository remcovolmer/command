import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useProjectStore } from '../../stores/projectStore'
import { SidecarTerminalPanel } from '../FileExplorer/SidecarTerminalPanel'

/**
 * Bottom shell drawer. Spans the center (chat + second panel), below the work
 * area. Scoped to the active chat's worktree-context (a shell belongs to a
 * working directory). Toggled from the activity-rail foot. Renders nothing
 * when there is no active context.
 */
export function ShellDrawer() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  // Context follows the active chat's worktree (or the project root).
  const activeWorktree = useProjectStore((s) => {
    const term = s.activeTerminalId ? s.terminals[s.activeTerminalId] : null
    return term?.worktreeId ? s.worktrees[term.worktreeId] : null
  })
  const contextKey = activeWorktree?.id ?? activeProjectId

  const sidecarTerminalIds = useProjectStore(
    useShallow((s) => (contextKey ? (s.sidecarTerminals[contextKey] ?? []) : []))
  )
  const terminals = useProjectStore((s) => s.terminals)
  const sidecarTerminals = useMemo(
    () => sidecarTerminalIds.map((id) => terminals[id]).filter(Boolean),
    [sidecarTerminalIds, terminals]
  )
  const activeSidecarTerminalId = useProjectStore((s) =>
    contextKey ? (s.activeSidecarTerminalId[contextKey] ?? null) : null
  )
  const sidecarTerminalCollapsed = useProjectStore((s) => s.sidecarTerminalCollapsed)

  const { createSidecarTerminal, closeSidecarTerminal, setActiveSidecarTerminal } = useProjectStore(
    useShallow((s) => ({
      createSidecarTerminal: s.createSidecarTerminal,
      closeSidecarTerminal: s.closeSidecarTerminal,
      setActiveSidecarTerminal: s.setActiveSidecarTerminal,
    }))
  )

  // Auto-select the first shell when the context changes.
  useEffect(() => {
    if (
      sidecarTerminals.length > 0 &&
      !sidecarTerminals.find((t) => t.id === activeSidecarTerminalId)
    ) {
      if (contextKey) setActiveSidecarTerminal(contextKey, sidecarTerminals[0].id)
    }
  }, [contextKey, sidecarTerminals, activeSidecarTerminalId, setActiveSidecarTerminal])

  if (!contextKey || !activeProjectId) return null
  // Keep the bottom clean: render the bar + tabs only when a shell is active and
  // expanded. Otherwise nothing shows here — only the rail-foot toggle is visible.
  if (sidecarTerminals.length === 0 || sidecarTerminalCollapsed) return null

  return (
    <div className="shrink-0 flex flex-col h-72">
      <SidecarTerminalPanel
        terminals={sidecarTerminals}
        activeTerminalId={activeSidecarTerminalId}
        onCreateTerminal={() => {
          if (contextKey && activeProjectId) {
            createSidecarTerminal(contextKey, activeProjectId, activeWorktree?.id ?? undefined)
          }
        }}
        onCloseTerminal={(id) => {
          if (contextKey) closeSidecarTerminal(contextKey, id)
        }}
        onSelectTerminal={(id) => {
          if (contextKey) setActiveSidecarTerminal(contextKey, id)
        }}
      />
    </div>
  )
}
