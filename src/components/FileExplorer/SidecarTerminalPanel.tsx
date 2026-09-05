import { useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useXtermInstance } from '../../hooks/useXtermInstance'
import { getStateColor } from '../../utils/terminalState'
import type { TerminalSession } from '../../types'

interface SidecarTerminalPanelProps {
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onCloseTerminal: (terminalId: string) => void
  onSelectTerminal: (terminalId: string) => void
}

function SidecarTerminalInstance({
  terminalId,
  isActive,
}: {
  terminalId: string
  isActive: boolean
}) {
  const removeTerminal = useProjectStore((s) => s.removeTerminal)
  const terminalProjectId = useProjectStore((s) => s.terminals[terminalId]?.projectId ?? '')

  const handleExit = useCallback(() => {
    removeTerminal(terminalId)
  }, [removeTerminal, terminalId])

  const containerRef = useXtermInstance({
    id: terminalId,
    isActive,
    projectId: terminalProjectId,
    fontSize: 13,
    scrollback: 3000,
    onExit: handleExit,
  })

  return (
    <div
      ref={containerRef}
      className="terminal-container absolute inset-0 bg-screen"
      style={{
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
      }}
    />
  )
}

/**
 * Renders the shell tab bar + active terminal for the bottom drawer. The drawer's
 * show/hide is owned by the activity-rail toggle, so there's no separate header.
 */
export function SidecarTerminalPanel({
  terminals,
  activeTerminalId,
  onCreateTerminal,
  onCloseTerminal,
  onSelectTerminal,
}: SidecarTerminalPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — same underline treatment as the chat/content tabs, at a
          smaller 32px/12px scale to fit the drawer. */}
      <div className="flex items-end gap-0.5 px-2 h-8 bg-canvas border-t border-b border-border shrink-0 overflow-x-auto scroll-hidden">
        {terminals.map((term) => {
          const isActive = term.id === activeTerminalId
          return (
            <button
              key={term.id}
              onClick={() => onSelectTerminal(term.id)}
              className={`
                group relative flex items-center gap-1.5 h-8 px-2 text-xs whitespace-nowrap shrink-0
                transition-colors select-none
                ${isActive ? 'text-fg-strong' : 'text-fg-muted hover:text-fg'}
                ${
                  isActive
                    ? 'after:absolute after:left-1.5 after:right-1.5 after:-bottom-px after:h-0.5 after:rounded-t after:bg-primary'
                    : ''
                }
              `}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStateColor(term.state)}`} />
              <span className="truncate max-w-[100px]">{term.title || 'Terminal'}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTerminal(term.id)
                }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-raised ml-0.5 transition-opacity"
                title="Close Terminal"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </button>
          )
        })}
        <button
          onClick={onCreateTerminal}
          className="p-1 mb-1 ml-0.5 rounded hover:bg-raised transition-colors shrink-0"
          title="New Terminal"
        >
          <Plus className="w-3.5 h-3.5 text-fg-muted" />
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 relative">
        {terminals.map((term) => (
          <SidecarTerminalInstance
            key={term.id}
            terminalId={term.id}
            isActive={term.id === activeTerminalId}
          />
        ))}
      </div>
    </div>
  )
}
