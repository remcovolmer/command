import { useEffect, useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { useProjectStore } from '../../stores/projectStore'
import { FileTree } from './FileTree'
import { GitStatusPanel } from './GitStatusPanel'
import { FileExplorerTabBar } from './FileExplorerTabBar'
import { SidecarTerminalPanel } from './SidecarTerminalPanel'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { getElectronAPI } from '../../utils/electron'

const GIT_REFRESH_INTERVAL = 10000 // 10 seconds

export function FileExplorer() {
  const api = useMemo(() => getElectronAPI(), [])

  // Data selectors - individual for granular subscription
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const activeTab = useProjectStore((s) => s.fileExplorerActiveTab)
  const setActiveTab = useProjectStore((s) => s.setFileExplorerActiveTab)
  const fileExplorerDeletingEntry = useProjectStore((s) => s.fileExplorerDeletingEntry)

  // Determine git context from active terminal (worktree or project root)
  const activeWorktree = useProjectStore((s) => {
    const term = s.activeTerminalId ? s.terminals[s.activeTerminalId] : null
    return term?.worktreeId ? s.worktrees[term.worktreeId] : null
  })
  const gitContextId = activeWorktree?.id ?? activeProjectId
  const gitContextPath = activeWorktree?.path

  const gitStatus = useProjectStore((s) => gitContextId ? s.gitStatus[gitContextId] : null)
  const isGitLoading = useProjectStore((s) => gitContextId ? s.gitStatusLoading[gitContextId] : false)

  // Sidecar terminal state — select ID array with shallow equality to avoid re-renders
  // Use activeWorktree (derived from active terminal) instead of activeWorktreeId to match Files/Git
  const sidecarContextKey = activeWorktree?.id ?? activeProjectId
  const sidecarTerminalIds = useProjectStore(
    useShallow((s) => sidecarContextKey ? (s.sidecarTerminals[sidecarContextKey] ?? []) : [])
  )
  const terminals = useProjectStore((s) => s.terminals)
  const sidecarTerminals = useMemo(
    () => sidecarTerminalIds.map((id) => terminals[id]).filter(Boolean),
    [sidecarTerminalIds, terminals]
  )
  const activeSidecarTerminalId = useProjectStore((s) =>
    sidecarContextKey ? s.activeSidecarTerminalId[sidecarContextKey] ?? null : null
  )
  const sidecarTerminalCollapsed = useProjectStore((s) => s.sidecarTerminalCollapsed)

  // Action selectors - grouped with useShallow for consistency
  const {
    clearDirectoryCache,
    setGitStatus,
    setGitStatusLoading,
    setSidecarTerminalCollapsed,
    createSidecarTerminal,
    closeSidecarTerminal,
    setActiveSidecarTerminal,
    setGitCommitLog,
    setGitHeadHash,
    gitHeadHash,
  } = useProjectStore(
    useShallow((s) => ({
      clearDirectoryCache: s.clearDirectoryCache,
      setActiveTab: s.setFileExplorerActiveTab,
      setGitStatus: s.setGitStatus,
      setGitStatusLoading: s.setGitStatusLoading,
      setSidecarTerminalCollapsed: s.setSidecarTerminalCollapsed,
      createSidecarTerminal: s.createSidecarTerminal,
      closeSidecarTerminal: s.closeSidecarTerminal,
      setActiveSidecarTerminal: s.setActiveSidecarTerminal,
      setGitCommitLog: s.setGitCommitLog,
      setGitHeadHash: s.setGitHeadHash,
      gitHeadHash: s.gitHeadHash,
    }))
  )

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  )
  // Both 'workspace' and 'project' types have limited functionality (no git, no sidecar)
  const isLimitedProject = useMemo(
    () => activeProject?.type === 'workspace' || activeProject?.type === 'project',
    [activeProject?.type]
  )

  // Auto-select first sidecar terminal when context changes
  useEffect(() => {
    if (sidecarTerminals.length > 0 && !sidecarTerminals.find((t) => t.id === activeSidecarTerminalId)) {
      if (sidecarContextKey) {
        setActiveSidecarTerminal(sidecarContextKey, sidecarTerminals[0].id)
      }
    }
  }, [sidecarContextKey, sidecarTerminals, activeSidecarTerminalId, setActiveSidecarTerminal])

  const handleCreateTerminal = async () => {
    if (activeProjectId && sidecarContextKey) {
      await createSidecarTerminal(sidecarContextKey, activeProjectId, activeWorktree?.id ?? undefined)
    }
  }

  const handleCloseTerminal = (terminalId: string) => {
    if (sidecarContextKey) {
      closeSidecarTerminal(sidecarContextKey, terminalId)
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

      // Smart refresh: check if HEAD changed, refresh commit log if so
      const newHead = await api.git.getHeadHash(gitPath)
      const oldHead = gitHeadHash[gitContextId]
      if (newHead && newHead !== oldHead) {
        setGitHeadHash(gitContextId, newHead)
        const log = await api.git.getCommitLog(gitPath)
        setGitCommitLog(gitContextId, log)
      }
    } catch (error) {
      console.error('Failed to fetch git status:', error)
    } finally {
      setGitStatusLoading(gitContextId, false)
    }
  }, [api, gitPath, gitContextId, setGitStatus, setGitStatusLoading, gitHeadHash, setGitHeadHash, setGitCommitLog])

  const handleGitRefreshRef = useRef(handleGitRefresh)
  handleGitRefreshRef.current = handleGitRefresh

  const handleRefresh = () => {
    if (activeTab === 'files') {
      handleFilesRefresh()
    } else {
      handleGitRefresh()
    }
  }

  useEffect(() => {
    if (gitContextId) {
      handleGitRefreshRef.current()
    }
  }, [gitContextId])

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

  const hasTerminals = sidecarTerminals.length > 0
  const isExpanded = hasTerminals && !sidecarTerminalCollapsed

  return (
    <div className="h-full flex flex-col bg-sidebar" data-file-explorer>
      {/* Tab Bar - at top */}
      <FileExplorerTabBar
        activeTab={isLimitedProject ? 'files' : activeTab}
        onTabChange={setActiveTab}
        gitChangeCount={totalGitChanges}
        isGitLoading={isGitLoading ?? false}
        onRefresh={handleRefresh}
        showGitTab={!isLimitedProject}
      />

      {/* Files/Git Content - takes remaining space */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeProject ? (
          (isLimitedProject || activeTab === 'files') ? (
            <FileTree project={activeProject} />
          ) : (
            <GitStatusPanel project={activeProject} gitContextId={gitContextId} gitPath={gitPath} onRefresh={handleGitRefresh} />
          )
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Select a project to view files
          </div>
        )}
      </div>

      {/* Terminal Panel - only render for code projects */}
      {sidecarContextKey && activeProjectId && !isLimitedProject && (
        <SidecarTerminalPanel
          contextKey={sidecarContextKey}
          projectId={activeProjectId}
          worktreeId={activeWorktree?.id ?? undefined}
          terminals={sidecarTerminals}
          activeTerminalId={activeSidecarTerminalId}
          isCollapsed={sidecarTerminalCollapsed}
          onToggleCollapse={handleToggleCollapse}
          onCreateTerminal={handleCreateTerminal}
          onCloseTerminal={handleCloseTerminal}
          onSelectTerminal={(id) => {
            setActiveSidecarTerminal(sidecarContextKey, id)
            if (sidecarTerminalCollapsed) {
              setSidecarTerminalCollapsed(false)
            }
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {fileExplorerDeletingEntry && activeProjectId && (
        <DeleteConfirmDialog
          entry={fileExplorerDeletingEntry}
          projectId={activeProjectId}
        />
      )}
    </div>
  )
}
