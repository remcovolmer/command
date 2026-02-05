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
      className={`terminal-container w-full h-full bg-sidebar relative ${
        isActive ? 'block pointer-events-auto' : 'hidden pointer-events-none'
      }`}
      data-terminal-active={isActive ? 'true' : 'false'}
    />
  )
}
