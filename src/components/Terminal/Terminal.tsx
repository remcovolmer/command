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
      style={{
        visibility: isActive ? 'visible' : 'hidden',
        position: isActive ? 'relative' : 'absolute',
        inset: isActive ? undefined : 0,
        pointerEvents: isActive ? 'auto' : 'none'
      }}
    />
  )
}
