import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Plus, FolderOpen, Terminal as TerminalIcon, X, GitBranch } from 'lucide-react'
import type { Project, TerminalSession, Worktree, TerminalState } from '../../types'
import { WorktreeItem } from '../Worktree/WorktreeItem'
import { ContextMenu } from './ContextMenu'
import { getElectronAPI } from '../../utils/electron'

interface SortableProjectItemProps {
  project: Project
  layoutId: string
  terminals: TerminalSession[]
  directTerminals: TerminalSession[]
  worktrees: Worktree[]
  getWorktreeTerminals: (worktreeId: string) => TerminalSession[]
  isActive: boolean
  activeTerminalId: string | null
  isDragging: boolean
  onSelect: (projectId: string) => void
  onRemove: (e: React.MouseEvent, projectId: string) => void
  onCreateTerminal: (projectId: string, worktreeId?: string) => void
  onCreateWorktree: (projectId: string) => void
  onRemoveWorktree: (worktreeId: string) => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (e: React.MouseEvent, id: string) => void
}

export const SortableProjectItem = memo(function SortableProjectItem({
  project,
  layoutId,
  terminals,
  directTerminals,
  worktrees,
  getWorktreeTerminals,
  isActive,
  activeTerminalId,
  isDragging,
  onSelect,
  onRemove,
  onCreateTerminal,
  onCreateWorktree,
  onRemoveWorktree,
  onSelectTerminal,
  onCloseTerminal,
}: SortableProjectItemProps) {
  const shouldReduceMotion = useReducedMotion()
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

  // Claude Code state colors (5 states)
  const stateColors: Record<TerminalState, string> = {
    busy: 'text-blue-500',       // Blue - working
    permission: 'text-orange-500', // Orange - needs permission
    question: 'text-orange-500', // Orange - waiting for question answer
    done: 'text-green-500',      // Green - finished, waiting for new prompt
    stopped: 'text-red-500',     // Red - stopped/error
  }

  // State-specific dot colors for terminal indicators
  const stateDots: Record<TerminalState, string> = {
    busy: 'bg-blue-500',
    permission: 'bg-orange-500',
    question: 'bg-orange-500',
    done: 'bg-green-500',
    stopped: 'bg-red-500',
  }

  // States that require user input (show blinking indicator)
  const inputStates = ['done', 'permission', 'question'] as const
  const isInputState = (state: string) => inputStates.includes(state as typeof inputStates[number])

  // States that should show an indicator (busy shows static, input states blink)
  const visibleStates = ['busy', 'done', 'permission', 'question'] as const
  const isVisibleState = (state: string) => visibleStates.includes(state as typeof visibleStates[number])

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const contextMenuItems = [
    {
      label: 'Open in File Explorer',
      onClick: () => getElectronAPI().shell.openPath(project.path),
    },
    {
      label: 'Open in Antigravity',
      onClick: () => getElectronAPI().shell.openInEditor(project.path),
    },
  ]

  return (
    <motion.li
      ref={setNodeRef}
      layoutId={layoutId}
      layout={shouldReduceMotion ? false : !isDragging}
      initial={false}
      style={style}
      className="relative"
    >
      {/* Drop indicator line */}
      {isOver && (
        <div className="absolute inset-x-0 -top-0.5 h-0.5 bg-primary rounded-full" />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Project Header */}
      <div
        onClick={() => onSelect(project.id)}
        onContextMenu={handleContextMenu}
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

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateTerminal(project.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-border"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateWorktree(project.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-border"
            title="New Worktree"
          >
            <GitBranch className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => onRemove(e, project.id)}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-border"
            title="Remove Project"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Direct Terminals (not in worktree) */}
      {directTerminals.length > 0 && (
        <ul className="ml-6 mt-1 space-y-0.5 border-l border-border">
          {directTerminals.map((terminal) => (
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

      {/* Worktrees */}
      {worktrees.map((worktree) => (
        <WorktreeItem
          key={worktree.id}
          worktree={worktree}
          terminals={getWorktreeTerminals(worktree.id)}
          activeTerminalId={activeTerminalId}
          onCreateTerminal={() => onCreateTerminal(project.id, worktree.id)}
          onSelectTerminal={onSelectTerminal}
          onCloseTerminal={onCloseTerminal}
          onRemove={() => onRemoveWorktree(worktree.id)}
        />
      ))}

      {/* Empty state for active project */}
      {isActive && terminals.length === 0 && worktrees.length === 0 && (
        <div className="ml-6 pl-3 py-2 border-l border-border">
          <button
            onClick={() => onCreateTerminal(project.id)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Terminal
          </button>
        </div>
      )}
    </motion.li>
  )
})
