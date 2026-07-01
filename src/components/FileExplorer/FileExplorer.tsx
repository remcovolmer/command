import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { useProjectStore } from '../../stores/projectStore'
import { FileTree } from './FileTree'
import { GitStatusPanel } from './GitStatusPanel'
import { TasksPanel } from './TasksPanel'
import { AutomationsPanel } from './AutomationsPanel'
import { SessionsPanel } from './SessionsPanel'
import { AutomationCreateDialog } from './AutomationCreateDialog'
import { FileExplorerHeader } from './FileExplorerHeader'
import { DeleteConfirmDialog } from './DeleteConfirmDialog'
import { getElectronAPI } from '../../utils/electron'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'

const GIT_DEBOUNCE_MS = 500
const GIT_FALLBACK_POLL_INTERVAL = 10000 // 10 seconds — only used on watcher error

export function FileExplorer() {
  const api = useMemo(() => getElectronAPI(), [])

  // Data selectors - individual for granular subscription
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const activeTab = useProjectStore((s) => s.fileExplorerActiveTab)
  const fileExplorerDeletingEntry = useProjectStore((s) => s.fileExplorerDeletingEntry)

  // Determine git context from active terminal (worktree or project root)
  const activeWorktree = useProjectStore((s) => {
    const term = s.activeTerminalId ? s.terminals[s.activeTerminalId] : null
    return term?.worktreeId ? s.worktrees[term.worktreeId] : null
  })
  const gitContextId = activeWorktree?.id ?? activeProjectId
  const gitContextPath = activeWorktree?.path

  const isGitLoading = useProjectStore((s) =>
    gitContextId ? s.gitStatusLoading[gitContextId] : false
  )

  // Action selectors - grouped with useShallow for consistency
  const {
    clearDirectoryCache,
    setGitStatus,
    setGitStatusLoading,
    setGitCommitLog,
    setGitHeadHash,
    gitHeadHash,
  } = useProjectStore(
    useShallow((s) => ({
      clearDirectoryCache: s.clearDirectoryCache,
      setGitStatus: s.setGitStatus,
      setGitStatusLoading: s.setGitStatusLoading,
      setGitCommitLog: s.setGitCommitLog,
      setGitHeadHash: s.setGitHeadHash,
      gitHeadHash: s.gitHeadHash,
    }))
  )

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  )

  // File explorer root: worktree path when active, otherwise project path
  const fileTreeRootPath = activeWorktree?.path ?? activeProject?.path
  const fileTreeContextKey = activeWorktree?.id ?? activeProjectId
  // 'project' type has no git tab (files, Claude, and shell are available)
  const isLimitedProject = useMemo(() => activeProject?.type === 'project', [activeProject?.type])

  const handleFilesRefresh = () => {
    if (activeProjectId) {
      clearDirectoryCache(activeProjectId, fileTreeRootPath)
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
  }, [
    api,
    gitPath,
    gitContextId,
    setGitStatus,
    setGitStatusLoading,
    gitHeadHash,
    setGitHeadHash,
    setGitCommitLog,
  ])

  const handleGitRefreshRef = useRef(handleGitRefresh)
  handleGitRefreshRef.current = handleGitRefresh

  const handleRefresh = () => {
    if (activeTab === 'files') {
      handleFilesRefresh()
    } else if (activeTab === 'tasks') {
      handleTasksRefresh()
    } else if (activeTab === 'automations') {
      // AutomationsPanel manages its own data loading
    } else {
      handleGitRefresh()
    }
  }

  useEffect(() => {
    if (gitContextId) {
      handleGitRefreshRef.current()
    }
  }, [gitContextId])

  // Operation lock: generation counter prevents stale watcher refreshes during git operations
  const operationGeneration = useRef(0)

  const handleOperationStart = useCallback(() => {
    ++operationGeneration.current
    // Cancel any pending watcher-triggered refresh
    if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current)
  }, [])

  const handleOperationEnd = useCallback(() => {
    // The refresh is handled by withOperation in GitStatusPanel via onRefresh
  }, [])

  // Event-driven git refresh via file watcher (replaces 10s polling)
  const gitDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [watcherFailed, setWatcherFailed] = useState(false)

  useEffect(() => {
    if (!activeProjectId) return

    const handleWatchEvents = () => {
      // Watcher is working again — stop fallback polling
      if (watcherFailed) setWatcherFailed(false)
      // Skip watcher-triggered refresh if a git operation is in progress
      const genAtSchedule = operationGeneration.current
      // Debounce: wait 500ms after last event batch before refreshing
      if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current)
      gitDebounceRef.current = setTimeout(() => {
        // If an operation started since we scheduled, skip (it will do its own refresh)
        if (operationGeneration.current !== genAtSchedule) return
        handleGitRefreshRef.current()
      }, GIT_DEBOUNCE_MS)
    }

    fileWatcherEvents.subscribe(activeProjectId, 'git-status', handleWatchEvents)
    fileWatcherEvents.subscribeError(activeProjectId, 'git-status', () => {
      setWatcherFailed(true)
    })

    return () => {
      fileWatcherEvents.unsubscribe(activeProjectId, 'git-status')
      if (gitDebounceRef.current) clearTimeout(gitDebounceRef.current)
    }
  }, [activeProjectId])

  // Fallback polling only when watcher has failed
  useEffect(() => {
    if (!watcherFailed || !gitContextId) return
    const interval = setInterval(() => handleGitRefreshRef.current(), GIT_FALLBACK_POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [watcherFailed, gitContextId])

  // Automation dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<
    import('../../types').Automation | null
  >(null)

  const handleTasksRefresh = useCallback(async () => {
    if (!activeProject) return
    const { setTasksLoading, setTasksData } = useProjectStore.getState()
    setTasksLoading(activeProject.id, true)
    try {
      const data = await api.tasks.scan(activeProject.path)
      setTasksData(activeProject.id, data)
    } catch (error) {
      console.error('Failed to scan tasks:', error)
    } finally {
      setTasksLoading(activeProject.id, false)
    }
  }, [api, activeProject])

  return (
    <div className="h-full flex flex-col bg-sidebar" data-file-explorer>
      {/* Session info - always visible */}
      <SessionsPanel />

      {/* Header — panel label, branch, refresh (tab switching lives in the rail) */}
      <FileExplorerHeader
        activeTab={isLimitedProject && activeTab === 'git' ? 'files' : activeTab}
        isGitLoading={isGitLoading ?? false}
        onRefresh={handleRefresh}
        worktreeBranch={activeWorktree?.branch}
      />

      {/* Files/Git/Tasks/Automations Content - takes remaining space */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'automations' ? (
          <AutomationsPanel
            onCreateClick={() => setShowCreateDialog(true)}
            onEditClick={(automation) => {
              setEditingAutomation(automation)
              setShowCreateDialog(true)
            }}
          />
        ) : activeProject ? (
          activeTab === 'tasks' ? (
            <TasksPanel project={activeProject} />
          ) : isLimitedProject || activeTab === 'files' ? (
            <FileTree
              project={activeProject}
              rootPath={fileTreeRootPath}
              contextKey={fileTreeContextKey}
            />
          ) : (
            <GitStatusPanel
              project={activeProject}
              gitContextId={gitContextId}
              gitPath={gitPath}
              onRefresh={handleGitRefresh}
              onOperationStart={handleOperationStart}
              onOperationEnd={handleOperationEnd}
            />
          )
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            Select a project to view files
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {fileExplorerDeletingEntry && activeProjectId && (
        <DeleteConfirmDialog
          entry={fileExplorerDeletingEntry}
          projectId={activeProjectId}
          contextKey={fileTreeContextKey ?? activeProjectId}
        />
      )}

      {/* Automation Create/Edit Dialog */}
      <AutomationCreateDialog
        isOpen={showCreateDialog}
        onClose={() => {
          setShowCreateDialog(false)
          setEditingAutomation(null)
        }}
        editAutomation={editingAutomation}
      />
    </div>
  )
}
