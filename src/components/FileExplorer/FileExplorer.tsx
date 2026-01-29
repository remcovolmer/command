import { useEffect, useCallback, useMemo, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useProjectStore } from '../../stores/projectStore'
import { FileTree } from './FileTree'
import { GitStatusPanel } from './GitStatusPanel'
import { FileExplorerTabBar } from './FileExplorerTabBar'
import { SidecarTerminal } from './SidecarTerminal'
import { getElectronAPI } from '../../utils/electron'

const GIT_REFRESH_INTERVAL = 10000 // 10 seconds

export function FileExplorer() {
  const api = useMemo(() => getElectronAPI(), [])
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const clearDirectoryCache = useProjectStore((s) => s.clearDirectoryCache)
  const activeTab = useProjectStore((s) => s.fileExplorerActiveTab)
  const setActiveTab = useProjectStore((s) => s.setFileExplorerActiveTab)

  // Determine git context from active terminal (worktree or project root)
  const activeWorktree = useProjectStore((s) => {
    const term = s.activeTerminalId ? s.terminals[s.activeTerminalId] : null
    return term?.worktreeId ? s.worktrees[term.worktreeId] : null
  })
  const gitContextId = activeWorktree?.id ?? activeProjectId
  const gitContextPath = activeWorktree?.path // project path resolved below via activeProject

  const gitStatus = useProjectStore((s) => gitContextId ? s.gitStatus[gitContextId] : null)
  const isGitLoading = useProjectStore((s) => gitContextId ? s.gitStatusLoading[gitContextId] : false)
  const setGitStatus = useProjectStore((s) => s.setGitStatus)
  const setGitStatusLoading = useProjectStore((s) => s.setGitStatusLoading)

  // Sidecar terminal state
  const sidecarTerminalId = useProjectStore((s) =>
    activeProjectId ? s.sidecarTerminals[activeProjectId] : null
  )
  const sidecarTerminalCollapsed = useProjectStore((s) => s.sidecarTerminalCollapsed)
  const setSidecarTerminalCollapsed = useProjectStore((s) => s.setSidecarTerminalCollapsed)
  const createSidecarTerminal = useProjectStore((s) => s.createSidecarTerminal)
  const closeSidecarTerminal = useProjectStore((s) => s.closeSidecarTerminal)

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const terminalPanelRef = useRef<ImperativePanelHandle>(null)

  // Sync panel collapse state with store
  useEffect(() => {
    const panel = terminalPanelRef.current
    if (!panel || !sidecarTerminalId) return
    if (sidecarTerminalCollapsed) {
      panel.collapse()
    } else {
      panel.expand()
    }
  }, [sidecarTerminalCollapsed, sidecarTerminalId])

  const handleOpenTerminal = async () => {
    if (activeProjectId) {
      await createSidecarTerminal(activeProjectId)
    }
  }

  const handleCloseTerminal = () => {
    if (activeProjectId) {
      closeSidecarTerminal(activeProjectId)
    }
  }

  const handleToggleCollapse = () => {
    setSidecarTerminalCollapsed(!sidecarTerminalCollapsed)
  }

  const handleFilesRefresh = () => {
    if (activeProjectId) {
      clearDirectoryCache(activeProjectId)
    }
  }

  const gitPath = gitContextPath ?? activeProject?.path
  const handleGitRefresh = useCallback(async () => {
    if (!gitPath || !gitContextId) return
    setGitStatusLoading(gitContextId, true)
    try {
      const status = await api.git.getStatus(gitPath)
      setGitStatus(gitContextId, status)
    } catch (error) {
      console.error('Failed to fetch git status:', error)
    } finally {
      setGitStatusLoading(gitContextId, false)
    }
  }, [api, gitPath, gitContextId, setGitStatus, setGitStatusLoading])

  // Use ref to avoid stale closure in effects
  const handleGitRefreshRef = useRef(handleGitRefresh)
  handleGitRefreshRef.current = handleGitRefresh

  const handleRefresh = () => {
    if (activeTab === 'files') {
      handleFilesRefresh()
    } else {
      handleGitRefresh()
    }
  }

  // Fetch git status on mount and when git context changes (project or worktree)
  useEffect(() => {
    if (gitContextId) {
      handleGitRefreshRef.current()
    }
  }, [gitContextId])

  // Auto-refresh git status
  useEffect(() => {
    if (!gitContextId) return
    const interval = setInterval(() => handleGitRefreshRef.current(), GIT_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [gitContextId])

  const totalGitChanges = gitStatus
    ? gitStatus.staged.length +
      gitStatus.modified.length +
      gitStatus.untracked.length +
      gitStatus.conflicted.length
    : 0

  return (
    <div className="h-full flex flex-col bg-sidebar">
      {/* Tab Bar - at top, same styling as TerminalTabBar */}
      <FileExplorerTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        gitChangeCount={totalGitChanges}
        isGitLoading={isGitLoading ?? false}
        onRefresh={handleRefresh}
        onOpenTerminal={!sidecarTerminalId ? handleOpenTerminal : undefined}
      />

      {/* Content with optional terminal panel */}
      <PanelGroup direction="vertical" autoSaveId="sidecar-layout" className="flex-1 min-h-0">
        {/* Files/Git Content */}
        <Panel id="sidecar-content" defaultSize={70} minSize={20}>
          <div className="h-full overflow-auto">
            {activeProject ? (
              activeTab === 'files' ? (
                <FileTree project={activeProject} />
              ) : (
                <GitStatusPanel project={activeProject} gitContextId={gitContextId} />
              )
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                Select a project to view files
              </div>
            )}
          </div>
        </Panel>

        {/* Terminal Panel - only show if terminal exists */}
        {sidecarTerminalId && activeProject && (
          <>
            <PanelResizeHandle className="h-1 bg-border hover:bg-primary transition-colors" />
            <Panel
              ref={terminalPanelRef}
              id="sidecar-terminal"
              defaultSize={30}
              minSize={10}
              maxSize={70}
              collapsible
              collapsedSize={0}
            >
              <SidecarTerminal
                terminalId={sidecarTerminalId}
                isCollapsed={sidecarTerminalCollapsed}
                onToggleCollapse={handleToggleCollapse}
                onClose={handleCloseTerminal}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
