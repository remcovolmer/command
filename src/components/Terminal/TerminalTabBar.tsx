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

// Claude Code specific state dot colors
const stateDots: Record<TerminalState, string> = {
  starting: 'bg-yellow-500',
  busy: 'bg-blue-500',
  question: 'bg-purple-500',
  permission: 'bg-orange-500',
  ready: 'bg-green-500',
  stopped: 'bg-muted-foreground',
  error: 'bg-destructive',
}

// States that require user input (show blinking indicator)
const inputStates = ['ready', 'question', 'permission'] as const
const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

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
                isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
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
