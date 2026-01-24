import { X, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { FileTree } from './FileTree'

export function FileExplorer() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const setFileExplorerVisible = useProjectStore((s) => s.setFileExplorerVisible)
  const clearDirectoryCache = useProjectStore((s) => s.clearDirectoryCache)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleClose = () => {
    setFileExplorerVisible(false)
  }

  const handleRefresh = () => {
    if (activeProjectId) {
      clearDirectoryCache(activeProjectId)
    }
  }

  return (
    <div className="h-full flex flex-col bg-claude-sidebar-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-claude-sidebar-border">
        <h2 className="text-sm font-medium text-claude-sidebar-text">Files</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-claude-sidebar-hover transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-claude-sidebar-muted" />
          </button>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-claude-sidebar-hover transition-colors"
            title="Close (Ctrl+Alt+B)"
          >
            <X className="w-4 h-4 text-claude-sidebar-muted" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {activeProject ? (
          <FileTree project={activeProject} />
        ) : (
          <div className="px-3 py-4 text-sm text-claude-sidebar-muted">
            Select a project to view files
          </div>
        )}
      </div>
    </div>
  )
}
