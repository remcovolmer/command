import { useXtermInstance } from '../../hooks/useXtermInstance'
import { useProjectStore } from '../../stores/projectStore'

interface TerminalProps {
  id: string
  isActive: boolean
}

export function Terminal({ id, isActive }: TerminalProps) {
  const terminalProjectId = useProjectStore((s) => s.terminals[id]?.projectId ?? '')

  const containerRef = useXtermInstance({
    id,
    isActive,
    projectId: terminalProjectId,
    fontSize: 14,
  })

  return (
    <div
      ref={containerRef}
      className="terminal-container chat-terminal absolute inset-0 bg-sidebar"
      style={{
        // Use visibility (not display:none) so inactive terminals keep their layout
        // dimensions. display:none zeroes the layout, which throttles xterm's
        // rAF-driven viewport sync and leaves the scrollbar stale on reactivation.
        // Mirrors the proven sidecar terminal approach (SidecarTerminalPanel).
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
      }}
      data-terminal-active={isActive ? 'true' : 'false'}
    />
  )
}
