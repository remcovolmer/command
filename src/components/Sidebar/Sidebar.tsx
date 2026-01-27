import { useEffect, useMemo, useState } from 'react'
import { Plus, FolderOpen, Sparkles, PanelRightOpen, PanelRightClose, Sun, Moon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import type { TerminalSession, Worktree } from '../../types'
import { getElectronAPI } from '../../utils/electron'
import { SortableProjectList } from './SortableProjectList'
import { CreateWorktreeDialog } from '../Worktree/CreateWorktreeDialog'

export function Sidebar() {
  // Use granular selectors to prevent unnecessary re-renders
  const projects = useProjectStore((s) => s.projects)
  const terminals = useProjectStore((s) => s.terminals)
  const worktrees = useProjectStore((s) => s.worktrees)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)
  const fileExplorerVisible = useProjectStore((s) => s.fileExplorerVisible)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)
  const theme = useProjectStore((s) => s.theme)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)

  // Group actions together with useShallow for stable reference
  const {
    setActiveProject,
    setActiveTerminal,
    addProject,
    removeProject,
    addTerminal,
    removeTerminal,
    addWorktree,
    removeWorktree,
    loadProjects,
    loadWorktrees,
    reorderProjects,
  } = useProjectStore(
    useShallow((s) => ({
      setActiveProject: s.setActiveProject,
      setActiveTerminal: s.setActiveTerminal,
      addProject: s.addProject,
      removeProject: s.removeProject,
      addTerminal: s.addTerminal,
      removeTerminal: s.removeTerminal,
      addWorktree: s.addWorktree,
      removeWorktree: s.removeWorktree,
      loadProjects: s.loadProjects,
      loadWorktrees: s.loadWorktrees,
      reorderProjects: s.reorderProjects,
    }))
  )

  const api = useMemo(() => getElectronAPI(), [])

  // State for worktree dialog
  const [worktreeDialogProjectId, setWorktreeDialogProjectId] = useState<string | null>(null)

  // Load projects on mount
  useEffect(() => {
    loadProjects().then(() => {
      // Load worktrees for all projects after projects are loaded
      projects.forEach((project) => {
        loadWorktrees(project.id)
      })
    })
  }, [loadProjects])

  // Load worktrees when projects change
  useEffect(() => {
    projects.forEach((project) => {
      loadWorktrees(project.id)
    })
  }, [projects.length, loadWorktrees])

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

  const handleCreateTerminal = async (projectId: string, worktreeId?: string) => {
    // Check terminal limit (max 3 per project)
    const projectTerminals = Object.values(terminals).filter(
      (t) => t.projectId === projectId
    )
    if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
      api.notification.show(
        'Terminal Limit',
        `Maximum ${MAX_TERMINALS_PER_PROJECT} terminals per project`
      )
      return
    }

    const terminalId = await api.terminal.create(projectId, worktreeId)

    // Determine terminal number
    const existingCount = worktreeId
      ? Object.values(terminals).filter((t) => t.worktreeId === worktreeId).length
      : Object.values(terminals).filter((t) => t.projectId === projectId && t.worktreeId === null).length

    const terminal: TerminalSession = {
      id: terminalId,
      projectId,
      worktreeId: worktreeId ?? null,
      state: 'busy',
      lastActivity: Date.now(),
      title: `Terminal ${existingCount + 1}`,
    }
    addTerminal(terminal)
  }

  const handleCreateWorktree = (projectId: string) => {
    setWorktreeDialogProjectId(projectId)
  }

  const handleWorktreeCreated = (worktree: Worktree) => {
    addWorktree(worktree)
    // Automatically create a terminal in the new worktree
    handleCreateTerminal(worktree.projectId, worktree.id)
  }

  const handleRemoveWorktree = async (worktreeId: string) => {
    // Check for uncommitted changes
    const hasChanges = await api.worktree.hasChanges(worktreeId)
    if (hasChanges) {
      const confirmed = window.confirm(
        'This worktree has uncommitted changes. Are you sure you want to remove it?'
      )
      if (!confirmed) return
    }

    try {
      // Close all terminals in worktree first
      Object.values(terminals)
        .filter((t) => t.worktreeId === worktreeId)
        .forEach((t) => {
          api.terminal.close(t.id)
          removeTerminal(t.id)
        })

      await api.worktree.remove(worktreeId, hasChanges)
      removeWorktree(worktreeId)
    } catch (error) {
      console.error('Failed to remove worktree:', error)
      api.notification.show('Error', 'Failed to remove worktree')
    }
  }

  const handleCloseTerminal = (e: React.MouseEvent, terminalId: string) => {
    e.stopPropagation()
    api.terminal.close(terminalId)
    removeTerminal(terminalId)
  }

  const getProjectTerminals = (projectId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.projectId === projectId)
  }

  const getProjectDirectTerminals = (projectId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.projectId === projectId && t.worktreeId === null)
  }

  const getWorktreeTerminals = (worktreeId: string): TerminalSession[] => {
    return Object.values(terminals).filter((t) => t.worktreeId === worktreeId)
  }

  const getProjectWorktrees = (projectId: string): Worktree[] => {
    return Object.values(worktrees).filter((w) => w.projectId === projectId)
  }

  // Check if any terminal in the project needs user input
  // (ready or permission states)
  const hasNeedsInput = (projectId: string): boolean => {
    const inputStates = ['ready', 'permission']
    return getProjectTerminals(projectId).some((t) => inputStates.includes(t.state))
  }

  return (
    <>
    <div className="flex flex-col h-full bg-sidebar">
      {/* Logo Header */}
      <div className="flex items-center gap-2 px-4 py-5">
        <Sparkles className="w-6 h-6 text-primary" />
        <h1 className="text-lg font-semibold text-sidebar-foreground">Command</h1>
      </div>

      {/* Add Project Button */}
      <div className="px-3 mb-2">
        <button
          onClick={handleAddProject}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-sidebar-accent hover:bg-muted text-sidebar-foreground text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add project
        </button>
      </div>

      {/* Projects Section */}
      <div className="px-3 py-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
          Projects
        </h2>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto sidebar-scroll px-3">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground mb-2">No projects yet</p>
            <button
              onClick={handleAddProject}
              className="text-sm text-primary hover:underline"
            >
              Add your first project
            </button>
          </div>
        ) : (
          <SortableProjectList
            projects={projects}
            getProjectTerminals={getProjectTerminals}
            getProjectDirectTerminals={getProjectDirectTerminals}
            getProjectWorktrees={getProjectWorktrees}
            getWorktreeTerminals={getWorktreeTerminals}
            activeProjectId={activeProjectId}
            activeTerminalId={activeTerminalId}
            hasNeedsInput={hasNeedsInput}
            onSelect={setActiveProject}
            onRemove={handleRemoveProject}
            onCreateTerminal={handleCreateTerminal}
            onCreateWorktree={handleCreateWorktree}
            onRemoveWorktree={handleRemoveWorktree}
            onSelectTerminal={setActiveTerminal}
            onCloseTerminal={handleCloseTerminal}
            onReorder={reorderProjects}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-sm font-medium text-primary-foreground">CC</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              Command
            </p>
            <p className="text-xs text-muted-foreground">
              v0.1.0
            </p>
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </button>
          <button
            onClick={toggleFileExplorer}
            className={`p-2 rounded-lg transition-colors ${
              fileExplorerVisible
                ? 'bg-sidebar-accent text-primary'
                : 'hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground'
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

    {/* Create Worktree Dialog */}
    {worktreeDialogProjectId && (
      <CreateWorktreeDialog
        projectId={worktreeDialogProjectId}
        isOpen={true}
        onClose={() => setWorktreeDialogProjectId(null)}
        onCreated={handleWorktreeCreated}
      />
    )}
    </>
  )
}
