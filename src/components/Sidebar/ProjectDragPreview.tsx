import { FolderOpen, Terminal as TerminalIcon } from 'lucide-react'
import type { Project } from '../../types'

interface ProjectDragPreviewProps {
  project: Project
  terminalCount: number
}

export function ProjectDragPreview({ project, terminalCount }: ProjectDragPreviewProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-sidebar-accent text-sidebar-foreground shadow-lg border border-border cursor-grabbing">
      <FolderOpen className="w-4 h-4 flex-shrink-0 text-primary" />
      <span className="flex-1 text-sm truncate max-w-[180px]">
        {project.name}
      </span>
      {terminalCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <TerminalIcon className="w-3 h-3" />
          <span>{terminalCount}</span>
        </div>
      )}
    </div>
  )
}
