import { useXtermInstance } from '../../hooks/useXtermInstance'
import { useProjectStore } from '../../stores/projectStore'

interface TerminalProps {
  id: string
  isActive: boolean
}

export function Terminal({ id, isActive }: TerminalProps) {
  const terminalProjectId = useProjectStore(s => s.terminals[id]?.projectId ?? '')

  const containerRef = useXtermInstance({
    id,
    isActive,
    projectId: terminalProjectId,
    fontSize: 14,
  })

  return (
    <div
      ref={containerRef}
      className={`terminal-container w-full h-full bg-sidebar relative ${
        isActive ? 'block pointer-events-auto' : 'hidden pointer-events-none'
      }`}
      data-terminal-active={isActive ? 'true' : 'false'}
    />
  )
}
