import { FolderOpen, Terminal as TerminalIcon } from 'lucide-react'
import type { Project } from '../../types'

interface ProjectDragPreviewProps {
  project: Project
  terminalCount: number
}

export function ProjectDragPreview({ project, terminalCount }: ProjectDragPreviewProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-claude-sidebar-hover text-claude-sidebar-text shadow-lg border border-claude-sidebar-border cursor-grabbing">
      <FolderOpen className="w-4 h-4 flex-shrink-0 text-claude-accent-primary" />
      <span className="flex-1 text-sm truncate max-w-[180px]">
        {project.name}
      </span>
      {terminalCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-claude-sidebar-muted">
          <TerminalIcon className="w-3 h-3" />
          <span>{terminalCount}</span>
        </div>
      )}
    </div>
  )
}
