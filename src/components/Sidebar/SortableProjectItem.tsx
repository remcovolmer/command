import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Plus, FolderOpen, Terminal as TerminalIcon, X, GitBranch, Code } from 'lucide-react'
import type { Project, TerminalSession, Worktree } from '../../types'
import { WorktreeItem } from '../Worktree/WorktreeItem'
import { ContextMenu } from './ContextMenu'
import { getElectronAPI } from '../../utils/electron'
import { STATE_TEXT_COLORS, STATE_DOT_COLORS, isInputState, isVisibleState } from '../../utils/terminalState'

interface SortableProjectItemProps {
  project: Project
  layoutId: string
  terminals: TerminalSession[]
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
}

export const SortableProjectItem = memo(function SortableProjectItem({
  project,
  layoutId,
  terminals,
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

  // Show empty state for active project when there are no terminals
  // Code projects also require no worktrees to show the empty state
  const showEmptyState = isActive && terminals.length === 0 &&
    (project.type !== 'code' || worktrees.length === 0)

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
        {project.type === 'code' ? (
          <Code
            className={`w-4 h-4 flex-shrink-0 ${
              isActive ? 'text-primary' : ''
            }`}
          />
        ) : (
          <FolderOpen
            className={`w-4 h-4 flex-shrink-0 ${
              isActive ? 'text-primary' : ''
            }`}
          />
        )}
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
            title="New Chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {project.type === 'code' && (
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
          )}
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

      {/* Worktrees */}
      {worktrees.map((worktree) => (
        <WorktreeItem
          key={worktree.id}
          worktree={worktree}
          terminals={getWorktreeTerminals(worktree.id)}
          activeTerminalId={activeTerminalId}
          onCreateTerminal={() => onCreateTerminal(project.id, worktree.id)}
          onSelectTerminal={onSelectTerminal}
          onRemove={() => onRemoveWorktree(worktree.id)}
        />
      ))}

      {/* Empty state for active project (code projects show when no terminals/worktrees, workspace/project when no terminals) */}
      {showEmptyState && (
        <div className="ml-6 pl-3 py-2 border-l border-border">
          <button
            onClick={() => onCreateTerminal(project.id)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Chat
          </button>
        </div>
      )}
    </motion.li>
  )
})
