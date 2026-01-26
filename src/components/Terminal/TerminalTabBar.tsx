import { TerminalIcon, Plus, X, LayoutGrid } from 'lucide-react'
import type { TerminalSession, TerminalState } from '../../types'

interface TerminalTabBarProps {
  terminals: TerminalSession[]
  activeTerminalId: string | null
  splitTerminalIds: string[]
  onSelect: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onUnsplit: (terminalId: string) => void
  onAdd: () => void
  canAdd: boolean
}

const stateDots: Record<TerminalState, string> = {
  starting: 'bg-yellow-500',
  running: 'bg-blue-500',
  needs_input: 'bg-primary',
  stopped: 'bg-muted-foreground',
  error: 'bg-destructive',
}

export function TerminalTabBar({
  terminals,
  activeTerminalId,
  splitTerminalIds,
  onSelect,
  onClose,
  onUnsplit,
  onAdd,
  canAdd,
}: TerminalTabBarProps) {
  const handleDragStart = (e: React.DragEvent, terminalId: string) => {
    e.dataTransfer.setData('terminalId', terminalId)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <div className="flex items-center gap-1 px-3 py-1 bg-sidebar-accent border-b border-border overflow-x-auto">
      {terminals.map((terminal) => {
        const isActive = terminal.id === activeTerminalId
        const isInSplit = splitTerminalIds.includes(terminal.id)

        return (
          <div
            key={terminal.id}
            draggable
            onDragStart={(e) => handleDragStart(e, terminal.id)}
            onClick={() => onSelect(terminal.id)}
            className={`
              group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer
              transition-colors select-none
              ${
                isActive
                  ? 'bg-sidebar text-sidebar-foreground'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
              }
            `}
          >
            <TerminalIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-sm font-medium whitespace-nowrap">
              {terminal.title}
            </span>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${stateDots[terminal.state]} ${
                terminal.state === 'needs_input' ? 'needs-input-indicator' : ''
              }`}
            />
            {isInSplit && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onUnsplit(terminal.id)
                }}
                className="p-0.5 rounded hover:bg-border transition-all"
                title="Remove from split"
              >
                <LayoutGrid className="w-3 h-3 text-primary" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(terminal.id)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}

      {canAdd && (
        <button
          onClick={onAdd}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 transition-colors"
          title="New Terminal"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
