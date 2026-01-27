import { memo } from 'react'
import { GitBranch, Terminal as TerminalIcon, Plus, X, Trash2 } from 'lucide-react'
import type { Worktree, TerminalSession } from '../../types'

interface WorktreeItemProps {
  worktree: Worktree
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (e: React.MouseEvent, id: string) => void
  onRemove: () => void
}

export const WorktreeItem = memo(function WorktreeItem({
  worktree,
  terminals,
  activeTerminalId,
  onCreateTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onRemove,
}: WorktreeItemProps) {
  // Simplified Claude Code state colors (4 states)
  const stateColors: Record<string, string> = {
    busy: 'text-blue-500',
    permission: 'text-orange-500',
    ready: 'text-green-500',
    stopped: 'text-red-500',
  }

  const stateDots: Record<string, string> = {
    busy: 'bg-blue-500',
    permission: 'bg-orange-500',
    question: 'bg-orange-500',
    done: 'bg-green-500',
    stopped: 'bg-red-500',
  }

  const inputStates = ['done', 'permission', 'question'] as const
  const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

  const visibleStates = ['busy', 'done', 'permission', 'question'] as const
  const isVisibleState = (state: string) => visibleStates.includes(state as typeof visibleStates[number])

  // Check if any terminal needs input
  const hasNeedsInput = terminals.some((t) => inputStates.includes(t.state as typeof inputStates[number]))

  return (
    <div className="mt-1 border-l border-primary/30 ml-6">
      {/* Worktree Header */}
      <div className="group flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-sidebar-foreground">
        <GitBranch className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="flex-1 text-xs font-medium truncate" title={worktree.branch}>
          {worktree.name}
        </span>

        {/* Needs input indicator */}
        {hasNeedsInput && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary needs-input-indicator" />
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateTerminal()
            }}
            className="p-0.5 rounded hover:bg-border"
            title="New Terminal in Worktree"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="p-0.5 rounded hover:bg-border text-muted-foreground hover:text-destructive"
            title="Remove Worktree"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Terminal List */}
      {terminals.length > 0 && (
        <ul className="ml-4 space-y-0.5">
          {terminals.map((terminal) => (
            <li
              key={terminal.id}
              onClick={() => onSelectTerminal(terminal.id)}
              className={`
                group flex items-center gap-2 px-3 py-1 cursor-pointer
                transition-colors duration-150
                ${terminal.id === activeTerminalId
                  ? 'text-sidebar-foreground'
                  : 'text-muted-foreground hover:text-sidebar-foreground'}
              `}
            >
              <TerminalIcon
                className={`w-3 h-3 flex-shrink-0 ${stateColors[terminal.state]}`}
              />
              <span className="flex-1 text-xs truncate">{terminal.title}</span>

              {/* State indicator */}
              {isVisibleState(terminal.state) && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${stateDots[terminal.state]} ${
                    isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
                  }`}
                />
              )}

              {/* Close button */}
              <button
                onClick={(e) => onCloseTerminal(e, terminal.id)}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
                title="Close Terminal"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state */}
      {terminals.length === 0 && (
        <div className="ml-4 px-3 py-1">
          <button
            onClick={onCreateTerminal}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Terminal
          </button>
        </div>
      )}
    </div>
  )
})
