import { Terminal } from './Terminal'
import { useTerminalPool } from '../../hooks/useTerminalPool'
import type { TerminalSession } from '../../types'

interface TerminalViewportProps {
  terminals: TerminalSession[]
  activeTerminalId: string | null
}

export function TerminalViewport({ terminals, activeTerminalId }: TerminalViewportProps) {
  // Terminal LRU pool — manage eviction based on active terminal
  useTerminalPool(activeTerminalId)

  if (terminals.length === 0) {
    return null
  }

  return (
    <div className="h-full w-full relative">
      {/* Render all terminals (hidden if not active) */}
      {terminals.map((terminal) => (
        <Terminal key={terminal.id} id={terminal.id} isActive={terminal.id === activeTerminalId} />
      ))}
    </div>
  )
}
