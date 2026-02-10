import { useCallback } from 'react'
import { ChevronDown, ChevronUp, Plus, X, TerminalSquare } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useXtermInstance } from '../../hooks/useXtermInstance'
import { getStateColor } from '../../utils/terminalState'
import type { TerminalSession } from '../../types'

interface SidecarTerminalPanelProps {
  contextKey: string
  projectId: string
  worktreeId?: string
  terminals: TerminalSession[]
  activeTerminalId: string | null
  isCollapsed: boolean
  onToggleCollapse: () => void
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
  const terminalProjectId = useProjectStore(s => s.terminals[terminalId]?.projectId ?? '')

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
      className="terminal-container absolute inset-0 bg-sidebar"
      style={{
        visibility: isActive ? 'visible' : 'hidden',
        pointerEvents: isActive ? 'auto' : 'none',
      }}
    />
  )
}

export function SidecarTerminalPanel({
  terminals,
  activeTerminalId,
  isCollapsed,
  onToggleCollapse,
  onCreateTerminal,
  onCloseTerminal,
  onSelectTerminal,
}: SidecarTerminalPanelProps) {
  const hasTerminals = terminals.length > 0
  const isExpanded = !isCollapsed && hasTerminals

  return (
    <div className={`flex flex-col shrink-0 ${isExpanded ? 'flex-1 min-h-[120px] max-h-[50%]' : ''}`}>
      {/* Header - always visible */}
      <div
        className="flex items-center justify-between px-2 py-1 bg-sidebar-accent border-t border-border shrink-0 cursor-pointer"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-2">
          {isCollapsed || !hasTerminals ? (
            <ChevronUp className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
          <TerminalSquare className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Terminal</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onCreateTerminal()
          }}
          className="p-0.5 rounded hover:bg-muted/50 transition-colors"
          title="New Terminal"
        >
          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Tab bar - visible when terminals exist (even when collapsed) */}
      {hasTerminals && (
        <div className="flex items-center bg-sidebar border-b border-border shrink-0 overflow-x-auto">
          {terminals.map((term) => {
            const isActive = term.id === activeTerminalId
            return (
              <button
                key={term.id}
                onClick={() => onSelectTerminal(term.id)}
                className={`
                  flex items-center gap-1 px-2 py-1 text-xs whitespace-nowrap shrink-0
                  transition-colors border-b-2
                  ${isActive
                    ? 'border-primary text-sidebar-foreground bg-sidebar-accent/50'
                    : 'border-transparent text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/30'
                  }
                `}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStateColor(term.state)}`} />
                <span className="truncate max-w-[80px]">{term.title || 'Terminal'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTerminal(term.id)
                  }}
                  className="p-0.5 rounded hover:bg-muted/50 ml-0.5"
                  title="Close Terminal"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </button>
            )
          })}
        </div>
      )}

      {/* Terminal content - always mounted when terminals exist, hidden via CSS when collapsed */}
      {hasTerminals && (
        <div
          className="flex-1 min-h-0 relative"
          style={{
            display: isCollapsed ? 'none' : 'block',
          }}
        >
          {terminals.map((term) => (
            <SidecarTerminalInstance
              key={term.id}
              terminalId={term.id}
              isActive={term.id === activeTerminalId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
