import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo } from 'react'
import { Plus, FolderOpen, Terminal as TerminalIcon, X } from 'lucide-react'
import type { Project, TerminalSession } from '../../types'

interface SortableProjectItemProps {
  project: Project
  terminals: TerminalSession[]
  isActive: boolean
  activeTerminalId: string | null
  hasNeedsInput: boolean
  isDragging: boolean
  onSelect: () => void
  onRemove: (e: React.MouseEvent) => void
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (e: React.MouseEvent, id: string) => void
}

export const SortableProjectItem = memo(function SortableProjectItem({
  project,
  terminals,
  isActive,
  activeTerminalId,
  hasNeedsInput,
  isDragging,
  onSelect,
  onRemove,
  onCreateTerminal,
  onSelectTerminal,
  onCloseTerminal,
}: SortableProjectItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isOver,
  } = useSortable({ id: project.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  // Simplified Claude Code state colors (4 states)
  const stateColors: Record<string, string> = {
    busy: 'text-blue-500',       // Blue - working
    permission: 'text-orange-500', // Orange - needs permission
    ready: 'text-green-500',     // Green - waiting for input
    stopped: 'text-red-500',     // Red - stopped/error
  }

  // State-specific dot colors for terminal indicators
  const stateDots: Record<string, string> = {
    busy: 'bg-blue-500',
    permission: 'bg-orange-500',
    ready: 'bg-green-500',
    stopped: 'bg-red-500',
  }

  // States that require user input (show blinking indicator)
  const inputStates = ['ready', 'permission'] as const
  const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

  // States that should show an indicator (busy shows static, input states blink)
  const visibleStates = ['busy', 'ready', 'permission'] as const
  const isVisibleState = (state: string) => visibleStates.includes(state as typeof visibleStates[number])

  return (
    <li ref={setNodeRef} style={style} className="relative">
      {/* Drop indicator line */}
      {isOver && (
        <div className="absolute inset-x-0 -top-0.5 h-0.5 bg-primary rounded-full" />
      )}

      {/* Project Header */}
      <div
        onClick={onSelect}
        {...attributes}
        {...listeners}
        className={`
          group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing
          transition-colors duration-150
          ${isActive
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-sidebar-foreground'}
        `}
      >
        <FolderOpen
          className={`w-4 h-4 flex-shrink-0 ${
            isActive ? 'text-primary' : ''
          }`}
        />
        <span className="flex-1 text-sm truncate" title={project.path}>
          {project.name}
        </span>

        {/* Notification indicator */}
        {hasNeedsInput && (
          <span className="w-2 h-2 rounded-full bg-primary needs-input-indicator" />
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateTerminal()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-border"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRemove}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-border"
            title="Remove Project"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal List */}
      {terminals.length > 0 && (
        <ul className="ml-6 mt-1 space-y-0.5 border-l border-border">
          {terminals.map((terminal) => (
            <li
              key={terminal.id}
              onClick={() => onSelectTerminal(terminal.id)}
              className={`
                group flex items-center gap-2 px-3 py-1.5 cursor-pointer
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

              {/* State indicator - shows for busy (static) and input states (blinking) */}
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

      {/* Empty state for active project */}
      {isActive && terminals.length === 0 && (
        <div className="ml-6 pl-3 py-2 border-l border-border">
          <button
            onClick={onCreateTerminal}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Terminal
          </button>
        </div>
      )}
    </li>
  )
})
