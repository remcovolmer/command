import { useXtermInstance } from '../../hooks/useXtermInstance'

interface TerminalProps {
  id: string
  isActive: boolean
}

export function Terminal({ id, isActive }: TerminalProps) {
  const containerRef = useXtermInstance({
    id,
    isActive,
    fontSize: 14,
  })

  return (
    <div
      ref={containerRef}
      className="terminal-container w-full h-full bg-sidebar"
      data-terminal-active={isActive ? 'true' : 'false'}
      style={{
        display: isActive ? 'block' : 'none',
        position: 'relative',
        pointerEvents: isActive ? 'auto' : 'none'
      }}
    />
  )
}
