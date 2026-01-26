import { useEffect, useCallback, useState, useMemo } from 'react'
import {
  GitBranch,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileX,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Check,
  Loader2,
} from 'lucide-react'
import type { Project, GitFileChange, GitBranchInfo } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'

interface GitStatusPanelProps {
  project: Project
}

const GIT_REFRESH_INTERVAL = 10000 // 10 seconds

export function GitStatusPanel({ project }: GitStatusPanelProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const gitStatus = useProjectStore((s) => s.gitStatus[project.id])
  const isLoading = useProjectStore((s) => s.gitStatusLoading[project.id])
  const setGitStatus = useProjectStore((s) => s.setGitStatus)
  const setGitStatusLoading = useProjectStore((s) => s.setGitStatusLoading)

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    staged: true,
    modified: true,
    untracked: false,
  })

  const fetchStatus = useCallback(async () => {
    setGitStatusLoading(project.id, true)
    try {
      const status = await api.git.getStatus(project.path)
      setGitStatus(project.id, status)
    } catch (error) {
      console.error('Failed to fetch git status:', error)
    } finally {
      setGitStatusLoading(project.id, false)
    }
  }, [api, project.id, project.path, setGitStatus, setGitStatusLoading])

  // Fetch on mount and when project changes
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Auto-refresh interval
  useEffect(() => {
    const interval = setInterval(fetchStatus, GIT_REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Calculate change counts for header summary
  const totalChanges = gitStatus
    ? gitStatus.staged.length +
      gitStatus.modified.length +
      gitStatus.untracked.length +
      gitStatus.conflicted.length
    : 0

  return (
    <div className="h-full flex flex-col border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-sidebar">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Git
          </h3>
          {gitStatus?.branch && (
            <span className="text-xs text-muted-foreground">
              ({gitStatus.branch.name})
            </span>
          )}
          {totalChanges > 0 && (
            <span className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded">
              {totalChanges}
            </span>
          )}
        </div>
        <button
          onClick={fetchStatus}
          disabled={isLoading}
          className="p-1 rounded hover:bg-sidebar-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Content - scrollable */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
          {!gitStatus ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !gitStatus.isGitRepo ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Not a git repository
            </div>
          ) : (
            <>
              {/* Branch Info */}
              {gitStatus.branch && <BranchSection branch={gitStatus.branch} />}

              {/* Status Indicator */}
              {gitStatus.isClean ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="w-4 h-4" />
                  <span>Working tree clean</span>
                </div>
              ) : (
                <>
                  {/* Staged Changes */}
                  {gitStatus.staged.length > 0 && (
                    <FileChangeSection
                      title="Staged"
                      files={gitStatus.staged}
                      expanded={expandedSections.staged}
                      onToggle={() => toggleSection('staged')}
                      variant="success"
                    />
                  )}

                  {/* Modified Changes */}
                  {gitStatus.modified.length > 0 && (
                    <FileChangeSection
                      title="Modified"
                      files={gitStatus.modified}
                      expanded={expandedSections.modified}
                      onToggle={() => toggleSection('modified')}
                      variant="warning"
                    />
                  )}

                  {/* Untracked Files */}
                  {gitStatus.untracked.length > 0 && (
                    <FileChangeSection
                      title="Untracked"
                      files={gitStatus.untracked}
                      expanded={expandedSections.untracked}
                      onToggle={() => toggleSection('untracked')}
                      variant="muted"
                    />
                  )}

                  {/* Conflicts */}
                  {gitStatus.conflicted.length > 0 && (
                    <FileChangeSection
                      title="Conflicts"
                      files={gitStatus.conflicted}
                      expanded={true}
                      onToggle={() => {}}
                      variant="error"
                    />
                  )}
                </>
              )}

              {gitStatus.error && (
                <div className="px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span className="truncate">{gitStatus.error}</span>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}

function BranchSection({ branch }: { branch: GitBranchInfo }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-primary" />
        <span className="text-sm text-sidebar-foreground font-medium truncate">
          {branch.name}
        </span>
      </div>
      {branch.upstream && (branch.ahead > 0 || branch.behind > 0) && (
        <div className="flex items-center gap-3 mt-1 ml-6 text-xs text-muted-foreground">
          {branch.ahead > 0 && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <ArrowUp className="w-3 h-3" />
              {branch.ahead}
            </span>
          )}
          {branch.behind > 0 && (
            <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
              <ArrowDown className="w-3 h-3" />
              {branch.behind}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function FileChangeSection({
  title,
  files,
  expanded,
  onToggle,
  variant,
}: {
  title: string
  files: GitFileChange[]
  expanded: boolean
  onToggle: () => void
  variant: 'success' | 'warning' | 'error' | 'muted'
}) {
  const colorClass = {
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    error: 'text-red-600 dark:text-red-400',
    muted: 'text-muted-foreground',
  }[variant]

  return (
    <div className="border-t border-border/50">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sidebar-accent transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
        <span className={`text-sm font-medium ${colorClass}`}>{title}</span>
        <span className="text-xs text-muted-foreground ml-auto">{files.length}</span>
      </button>
      {expanded && (
        <div className="pb-1">
          {files.map((file) => (
            <FileChangeItem key={file.path} file={file} variant={variant} />
          ))}
        </div>
      )}
    </div>
  )
}

function FileChangeItem({
  file,
  variant,
}: {
  file: GitFileChange
  variant: 'success' | 'warning' | 'error' | 'muted'
}) {
  const Icon = {
    modified: FileEdit,
    added: FilePlus,
    deleted: FileX,
    renamed: FileEdit,
    untracked: FilePlus,
    conflicted: AlertCircle,
  }[file.status]

  const colorClass = {
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    error: 'text-red-600 dark:text-red-400',
    muted: 'text-muted-foreground',
  }[variant]

  // Get just the filename
  const fileName = file.path.split(/[/\\]/).pop() || file.path

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 ml-4 text-sm hover:bg-sidebar-accent rounded transition-colors"
      title={file.path}
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${colorClass}`} />
      <span className="text-sidebar-foreground truncate">{fileName}</span>
    </div>
  )
}
