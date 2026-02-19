import { useState, useCallback } from 'react'
import {
  GitBranch,
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
  Download,
  History,
} from 'lucide-react'
import type { Project, GitFileChange, GitBranchInfo } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { CommitHistory } from './CommitHistory'

interface GitStatusPanelProps {
  project: Project
  gitContextId?: string | null
  gitPath?: string
  onRefresh?: () => void
}

export function GitStatusPanel({ project, gitContextId, gitPath, onRefresh }: GitStatusPanelProps) {
  const contextKey = gitContextId ?? project.id
  const gitStatus = useProjectStore((s) => s.gitStatus[contextKey])
  const effectiveGitPath = gitPath ?? project.path

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    staged: true,
    modified: true,
    untracked: false,
  })

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  return (
    <div className="h-full flex flex-col">
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
          {/* Top section: branch info + working tree status (collapsible, scrollable) */}
          <div className="flex-shrink-0 max-h-[50%] overflow-y-auto sidebar-scroll">
            {/* Branch Info */}
            {gitStatus.branch && (
              <BranchSection
                branch={gitStatus.branch}
                gitPath={effectiveGitPath}
                onRefresh={onRefresh}
              />
            )}

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
          </div>

          {/* Commit History section - fills remaining space */}
          <div className="flex-1 min-h-0 flex flex-col border-t border-border/50">
            <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Commits
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <CommitHistory
                gitPath={effectiveGitPath}
                contextId={contextKey}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function BranchSection({
  branch,
  gitPath,
  onRefresh,
}: {
  branch: GitBranchInfo
  gitPath: string
  onRefresh?: () => void
}) {
  const api = getElectronAPI()
  const [loading, setLoading] = useState<'fetch' | 'pull' | 'push' | null>(null)

  const handleGitAction = useCallback(async (action: 'fetch' | 'pull' | 'push') => {
    setLoading(action)
    try {
      await api.git[action](gitPath)
      onRefresh?.()
    } catch (err) {
      api.notification.show(
        'Git Operation Failed',
        err instanceof Error ? err.message : `${action} failed`
      )
    } finally {
      setLoading(null)
    }
  }, [api, gitPath, onRefresh])

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-primary" />
        <span className="text-sm text-sidebar-foreground font-medium truncate flex-1">
          {branch.name}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleGitAction('fetch')}
            disabled={loading !== null}
            className="p-1 rounded hover:bg-muted/50 transition-colors"
            title="Fetch"
          >
            {loading === 'fetch' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Download className="w-3.5 h-3.5 text-muted-foreground hover:text-sidebar-foreground" />
            )}
          </button>
          <button
            onClick={() => handleGitAction('pull')}
            disabled={loading !== null || !branch.upstream}
            className="p-1 rounded hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={!branch.upstream ? 'No upstream branch configured' : `Pull${branch.behind > 0 ? ` (${branch.behind} behind)` : ''}`}
          >
            {loading === 'pull' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <ArrowDown className={`w-3.5 h-3.5 ${branch.behind > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground hover:text-sidebar-foreground'}`} />
            )}
          </button>
          <button
            onClick={() => handleGitAction('push')}
            disabled={loading !== null || !branch.upstream || branch.ahead === 0}
            className="p-1 rounded hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={!branch.upstream ? 'No upstream branch configured' : `Push${branch.ahead > 0 ? ` (${branch.ahead} ahead)` : ''}`}
          >
            {loading === 'push' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            ) : (
              <ArrowUp className={`w-3.5 h-3.5 ${branch.ahead > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground hover:text-sidebar-foreground'}`} />
            )}
          </button>
        </div>
      </div>
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
      className="flex items-center gap-2 px-3 py-1 ml-4 text-sm hover:bg-sidebar-accent rounded transition-colors min-w-0"
      title={file.path}
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${colorClass}`} />
      <span className="text-sidebar-foreground truncate min-w-0">{fileName}</span>
    </div>
  )
}
