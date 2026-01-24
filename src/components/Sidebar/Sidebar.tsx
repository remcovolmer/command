import { memo, useEffect, useMemo } from 'react'
import { Plus, FolderOpen, Terminal as TerminalIcon, X, Sparkles } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import type { Project, TerminalSession } from '../../types'
import { getElectronAPI } from '../../utils/electron'

export function Sidebar() {
  // Use granular selectors to prevent unnecessary re-renders
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)

  // Group actions together with useShallow for stable reference
  const {
    setActiveProject,
    setActiveTerminal,
    addProject,
    removeProject,
    addTerminal,
    removeTerminal,
    loadProjects,
  } = useProjectStore(
    useShallow((s) => ({
      setActiveProject: s.setActiveProject,
      setActiveTerminal: s.setActiveTerminal,
      addProject: s.addProject,
      removeProject: s.removeProject,
      addTerminal: s.addTerminal,
      removeTerminal: s.removeTerminal,
      loadProjects: s.loadProjects,
    }))
  )

  const api = useMemo(() => getElectronAPI(), [])

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleAddProject = async () => {
    const folderPath = await api.project.selectFolder()
    if (folderPath) {
      const project = await api.project.add(folderPath)
      addProject(project)
    }
  }

  const handleRemoveProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    await api.project.remove(projectId)
    removeProject(projectId)
  }

  const handleCreateTerminal = async (projectId: string) => {
    // Check terminal limit (max 3 per project)
    const projectTerminals = Object.values(terminals).filter(
      (t) => t.projectId === projectId
    )
    if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
      // Show notification or toast
      api.notification.show(
        'Terminal Limit',
        `Maximum ${MAX_TERMINALS_PER_PROJECT} terminals per project`
      )
      return
    }

    const terminalId = await api.terminal.create(projectId)
    const terminal: TerminalSession = {
      id: terminalId,
      projectId,
      state: 'starting',
      lastActivity: Date.now(),
      title: `Terminal ${projectTerminals.length + 1}`,
    }
    addTerminal(terminal)
  }

  const handleCloseTerminal = (e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation()
    api.terminal.close(terminalId)
    removeTerminal(terminalId)
  }

  const getProjectTerminals = (projectId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.projectId === projectId)
  }

  const hasNeedsInput = (projectId: string): boolean => {
    return getProjectTerminals(projectId).some((t) => t.state === 'needs_input')
  }

  return (
    <div className="flex flex-col h-full bg-claude-sidebar-bg">
      {/* Logo Header */}
      <div className="flex items-center gap-2 px-4 py-5">
        <Sparkles className="w-6 h-6 text-claude-accent-primary" />
        <h1 className="text-lg font-semibold text-claude-sidebar-text">Command</h1>
      </div>

      {/* Add Project Button */}
      <div className="px-3 mb-2">
        <button
          onClick={handleAddProject}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-claude-sidebar-surface hover:bg-claude-sidebar-hover text-claude-sidebar-text text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add project
        </button>
      </div>

      {/* Projects Section */}
      <div className="px-3 py-2">
        <h2 className="text-xs font-medium text-claude-sidebar-muted uppercase tracking-wider px-3 mb-2">
          Projects
        </h2>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto sidebar-scroll px-3">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 text-claude-sidebar-muted opacity-50" />
            <p className="text-sm text-claude-sidebar-muted mb-2">No projects yet</p>
            <button
              onClick={handleAddProject}
              className="text-sm text-claude-accent-primary hover:underline"
            >
              Add your first project
            </button>
          </div>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                terminals={getProjectTerminals(project.id)}
                isActive={project.id === activeProjectId}
                activeTerminalId={activeTerminalId}
                hasNeedsInput={hasNeedsInput(project.id)}
                onSelect={() => setActiveProject(project.id)}
                onRemove={(e) => handleRemoveProject(e, project.id)}
                onCreateTerminal={() => handleCreateTerminal(project.id)}
                onSelectTerminal={setActiveTerminal}
                onCloseTerminal={handleCloseTerminal}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-claude-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-claude-accent-primary flex items-center justify-center">
            <span className="text-sm font-medium text-white">CC</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-claude-sidebar-text truncate">
              Command Center
            </p>
            <p className="text-xs text-claude-sidebar-muted">
              v1.0.0
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ProjectItemProps {
  project: Project
  terminals: TerminalSession[]
  isActive: boolean
  activeTerminalId: string | null
  hasNeedsInput: boolean
  onSelect: () => void
  onRemove: (e: React.MouseEvent) => void
  onCreateTerminal: () => void
  onSelectTerminal: (id: string) => void
  onCloseTerminal: (e: React.MouseEvent, id: string) => void
}

const ProjectItem = memo(function ProjectItem({
  project,
  terminals,
  isActive,
  activeTerminalId,
  hasNeedsInput,
  onSelect,
  onRemove,
  onCreateTerminal,
  onSelectTerminal,
  onCloseTerminal,
}: ProjectItemProps) {
  return (
    <li>
      {/* Project Header */}
      <div
        onClick={onSelect}
        className={`
          group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer
          transition-colors duration-150
          ${isActive
            ? 'bg-claude-sidebar-hover text-claude-sidebar-text'
            : 'text-claude-sidebar-muted hover:bg-claude-sidebar-surface hover:text-claude-sidebar-text'}
        `}
      >
        <FolderOpen
          className={`w-4 h-4 flex-shrink-0 ${
            isActive ? 'text-claude-accent-primary' : ''
          }`}
        />
        <span
          className="flex-1 text-sm truncate"
          title={project.path}
        >
          {project.name}
        </span>

        {/* Notification indicator */}
        {hasNeedsInput && (
          <span className="w-2 h-2 rounded-full bg-claude-accent-primary needs-input-indicator" />
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCreateTerminal()
            }}
            className="p-1 rounded hover:bg-claude-sidebar-border"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-claude-sidebar-border"
            title="Remove Project"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal List */}
      {isActive && terminals.length > 0 && (
        <ul className="ml-6 mt-1 space-y-0.5 border-l border-claude-sidebar-border">
          {terminals.map((terminal) => (
            <TerminalItem
              key={terminal.id}
              terminal={terminal}
              isActive={terminal.id === activeTerminalId}
              onSelect={() => onSelectTerminal(terminal.id)}
              onClose={(e) => onCloseTerminal(e, terminal.id)}
            />
          ))}
        </ul>
      )}

      {/* Empty state for active project */}
      {isActive && terminals.length === 0 && (
        <div className="ml-6 pl-3 py-2 border-l border-claude-sidebar-border">
          <button
            onClick={onCreateTerminal}
            className="flex items-center gap-2 text-xs text-claude-sidebar-muted hover:text-claude-accent-primary transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Terminal
          </button>
        </div>
      )}
    </li>
  )
})

interface TerminalItemProps {
  terminal: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
}

const TerminalItem = memo(function TerminalItem({ terminal, isActive, onSelect, onClose }: TerminalItemProps) {
  const stateColors = {
    starting: 'text-claude-warning',
    running: 'text-claude-info',
    needs_input: 'text-claude-accent-primary',
    stopped: 'text-claude-sidebar-muted',
    error: 'text-claude-error',
  }

  return (
    <li
      onClick={onSelect}
      className={`
        group flex items-center gap-2 px-3 py-1.5 cursor-pointer
        transition-colors duration-150
        ${isActive
          ? 'text-claude-sidebar-text'
          : 'text-claude-sidebar-muted hover:text-claude-sidebar-text'}
      `}
    >
      <TerminalIcon
        className={`w-3 h-3 flex-shrink-0 ${stateColors[terminal.state]}`}
      />
      <span className="flex-1 text-xs truncate">
        {terminal.title}
      </span>

      {/* Needs input indicator */}
      {terminal.state === 'needs_input' && (
        <span className="w-1.5 h-1.5 rounded-full bg-claude-accent-primary needs-input-indicator" />
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-claude-sidebar-border transition-opacity"
        title="Close Terminal"
      >
        <X className="w-3 h-3" />
      </button>
    </li>
  )
})
