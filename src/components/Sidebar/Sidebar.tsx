import { useEffect, useMemo } from 'react'
import { Plus, FolderOpen, Sparkles, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import type { TerminalSession } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { SortableProjectList } from './SortableProjectList'

export function Sidebar() {
  // Use granular selectors to prevent unnecessary re-renders
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)
  const fileExplorerVisible = useProjectStore((s) => s.fileExplorerVisible)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)

  // Group actions together with useShallow for stable reference
  const {
    setActiveProject,
    setActiveTerminal,
    addProject,
    removeProject,
    addTerminal,
    removeTerminal,
    loadProjects,
    reorderProjects,
  } = useProjectStore(
    useShallow((s) => ({
      setActiveProject: s.setActiveProject,
      setActiveTerminal: s.setActiveTerminal,
      addProject: s.addProject,
      removeProject: s.removeProject,
      addTerminal: s.addTerminal,
      removeTerminal: s.removeTerminal,
      loadProjects: s.loadProjects,
      reorderProjects: s.reorderProjects,
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
          <SortableProjectList
            projects={projects}
            getProjectTerminals={getProjectTerminals}
            activeProjectId={activeProjectId}
            activeTerminalId={activeTerminalId}
            hasNeedsInput={hasNeedsInput}
            onSelect={setActiveProject}
            onRemove={handleRemoveProject}
            onCreateTerminal={handleCreateTerminal}
            onSelectTerminal={setActiveTerminal}
            onCloseTerminal={handleCloseTerminal}
            onReorder={reorderProjects}
          />
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
              Command
            </p>
            <p className="text-xs text-claude-sidebar-muted">
              v0.1.0
            </p>
          </div>
          <button
            onClick={toggleFileExplorer}
            className={`p-2 rounded-lg transition-colors ${
              fileExplorerVisible
                ? 'bg-claude-sidebar-hover text-claude-accent-primary'
                : 'hover:bg-claude-sidebar-hover text-claude-sidebar-muted hover:text-claude-sidebar-text'
            }`}
            title={fileExplorerVisible ? 'Hide Files (Ctrl+Alt+B)' : 'Show Files (Ctrl+Alt+B)'}
          >
            {fileExplorerVisible ? (
              <PanelRightClose className="w-5 h-5" />
            ) : (
              <PanelRightOpen className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
