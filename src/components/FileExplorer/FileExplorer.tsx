import { useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { FileTree } from './FileTree'
import { GitStatusPanel } from './GitStatusPanel'
import { FileExplorerTabBar } from './FileExplorerTabBar'
import { getElectronAPI } from '../../utils/electron'

const GIT_REFRESH_INTERVAL = 10000 // 10 seconds

export function FileExplorer() {
  const api = useMemo(() => getElectronAPI(), [])
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const setFileExplorerVisible = useProjectStore((s) => s.setFileExplorerVisible)
  const clearDirectoryCache = useProjectStore((s) => s.clearDirectoryCache)
  const activeTab = useProjectStore((s) => s.fileExplorerActiveTab)
  const setActiveTab = useProjectStore((s) => s.setFileExplorerActiveTab)
  const gitStatus = useProjectStore((s) => activeProjectId ? s.gitStatus[activeProjectId] : null)
  const isGitLoading = useProjectStore((s) => activeProjectId ? s.gitStatusLoading[activeProjectId] : false)
  const setGitStatus = useProjectStore((s) => s.setGitStatus)
  const setGitStatusLoading = useProjectStore((s) => s.setGitStatusLoading)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const handleClose = () => {
    setFileExplorerVisible(false)
  }

  const handleFilesRefresh = () => {
    if (activeProjectId) {
      clearDirectoryCache(activeProjectId)
    }
  }

  const handleGitRefresh = useCallback(async () => {
    if (!activeProject) return
    setGitStatusLoading(activeProject.id, true)
    try {
      const status = await api.git.getStatus(activeProject.path)
      setGitStatus(activeProject.id, status)
    } catch (error) {
      console.error('Failed to fetch git status:', error)
    } finally {
      setGitStatusLoading(activeProject.id, false)
    }
  }, [api, activeProject, setGitStatus, setGitStatusLoading])

  const handleRefresh = () => {
    if (activeTab === 'files') {
      handleFilesRefresh()
    } else {
      handleGitRefresh()
    }
  }

  // Fetch git status on mount and when project changes
  useEffect(() => {
    if (activeProject) {
      handleGitRefresh()
    }
  }, [activeProject?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh git status
  useEffect(() => {
    if (!activeProject) return
    const interval = setInterval(handleGitRefresh, GIT_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [handleGitRefresh, activeProject])

  const totalGitChanges = gitStatus
    ? gitStatus.staged.length +
      gitStatus.modified.length +
      gitStatus.untracked.length +
      gitStatus.conflicted.length
    : 0

  return (
    <div className="h-full flex flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-border">
        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-sidebar-accent transition-colors"
          title="Close (Ctrl+Alt+B)"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Tab Bar */}
      <FileExplorerTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        gitChangeCount={totalGitChanges}
        isGitLoading={isGitLoading ?? false}
        onRefresh={handleRefresh}
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
        {activeProject ? (
          activeTab === 'files' ? (
            <FileTree project={activeProject} />
          ) : (
            <GitStatusPanel project={activeProject} />
          )
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Select a project to view files
          </div>
        )}
      </div>
    </div>
  )
}
