import { useRef, useState } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProjectStore } from '../../stores/projectStore'
import { FileTree } from './FileTree'
import { GitStatusPanel, GitStatusHeader } from './GitStatusPanel'

export function FileExplorer() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const setFileExplorerVisible = useProjectStore((s) => s.setFileExplorerVisible)
  const clearDirectoryCache = useProjectStore((s) => s.clearDirectoryCache)
  const gitPanelRef = useRef<ImperativePanelHandle>(null)
  const [gitPanelCollapsed, setGitPanelCollapsed] = useState(false)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleClose = () => {
    setFileExplorerVisible(false)
  }

  const handleRefresh = () => {
    if (activeProjectId) {
      clearDirectoryCache(activeProjectId)
    }
  }

  const handleToggleGitPanel = () => {
    const panel = gitPanelRef.current
    if (!panel) return

    if (panel.isCollapsed()) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }

  return (
    <div className="h-full flex flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h2 className="text-sm font-medium text-sidebar-foreground">Files</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-sidebar-accent transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-sidebar-accent transition-colors"
            title="Close (Ctrl+Alt+B)"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeProject ? (
          <>
            <PanelGroup direction="vertical" autoSaveId="file-explorer-layout" className="flex-1">
              {/* Files Panel */}
              <Panel id="files" defaultSize={70} minSize={20}>
                <div className="h-full overflow-y-auto sidebar-scroll">
                  <FileTree project={activeProject} />
                </div>
              </Panel>

              {/* Resize Handle */}
              <PanelResizeHandle className="h-1 bg-transparent hover:bg-border transition-colors cursor-row-resize" />

              {/* Git Panel Content (collapsible) */}
              <Panel
                ref={gitPanelRef}
                id="git"
                defaultSize={30}
                minSize={0}
                collapsible
                collapsedSize={0}
                onCollapse={() => setGitPanelCollapsed(true)}
                onExpand={() => setGitPanelCollapsed(false)}
              >
                <GitStatusPanel project={activeProject} />
              </Panel>
            </PanelGroup>

            {/* Git Header - always visible at bottom */}
            <GitStatusHeader
              project={activeProject}
              onToggle={handleToggleGitPanel}
              isCollapsed={gitPanelCollapsed}
            />
          </>
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Select a project to view files
          </div>
        )}
      </div>
    </div>
  )
}
