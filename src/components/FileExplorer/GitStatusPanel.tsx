import { useState, useCallback, useRef } from 'react'
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
  Plus,
  Minus,
  X,
  CheckCircle,
} from 'lucide-react'
import type { Project, GitFileChange, GitBranchInfo } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { CommitHistory } from './CommitHistory'
import { CommitForm } from './CommitForm'
import { BranchDropdown } from './BranchDropdown'
import { DiscardConfirmDialog } from './DiscardConfirmDialog'
import { btnIcon } from '../ui/controls'

interface GitStatusPanelProps {
  project: Project
  gitContextId?: string | null
  gitPath?: string
  onRefresh?: () => void
  onOperationStart?: () => void
  onOperationEnd?: () => void
}

export function GitStatusPanel({
  project,
  gitContextId,
  gitPath,
  onRefresh,
  onOperationStart,
  onOperationEnd,
}: GitStatusPanelProps) {
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

  const withOperation = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      const api = getElectronAPI()
      onOperationStart?.()
      try {
        await fn()
        onRefresh?.()
        return true
      } catch (err) {
        api.notification.show(
          'Git Operation Failed',
          err instanceof Error ? err.message : 'Operation failed'
        )
        return false
      } finally {
        onOperationEnd?.()
      }
    },
    [onRefresh, onOperationStart, onOperationEnd]
  )

  return (
    <div className="h-full flex flex-col">
      {!gitStatus ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
        </div>
      ) : !gitStatus.isGitRepo ? (
        <div className="px-3 py-2 text-[13px] text-fg-muted">Not a git repository</div>
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
              <div className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-success">
                <Check className="w-4 h-4" strokeWidth={1.5} />
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
                    sectionType="staged"
                    gitPath={effectiveGitPath}
                    projectId={project.id}
                    withOperation={withOperation}
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
                    sectionType="modified"
                    gitPath={effectiveGitPath}
                    projectId={project.id}
                    withOperation={withOperation}
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
                    sectionType="untracked"
                    gitPath={effectiveGitPath}
                    projectId={project.id}
                    withOperation={withOperation}
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
                    sectionType="conflicted"
                    gitPath={effectiveGitPath}
                    projectId={project.id}
                    withOperation={withOperation}
                  />
                )}

                {/* Commit Form */}
                <CommitForm
                  gitPath={effectiveGitPath}
                  hasStagedFiles={gitStatus.staged.length > 0}
                  withOperation={withOperation}
                />
              </>
            )}

            {gitStatus.error && (
              <div className="px-3 py-2 text-[12.5px] text-danger flex items-center gap-2">
                <AlertCircle className="w-4 h-4" strokeWidth={1.5} />
                <span className="truncate">{gitStatus.error}</span>
              </div>
            )}
          </div>

          {/* Commit History section - fills remaining space */}
          <div className="flex-1 min-h-0 flex flex-col border-t border-border">
            <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0">
              <History className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.5} />
              <span className="eyebrow">Commits</span>
            </div>
            <div className="flex-1 min-h-0">
              <CommitHistory gitPath={effectiveGitPath} contextId={contextKey} />
            </div>
          </div>
        </>
      )}

      {/* Discard confirmation dialog (rendered via store state) */}
      <DiscardConfirmDialog gitPath={effectiveGitPath} onComplete={onRefresh} />
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
  const [loading, setLoading] = useState<'fetch' | 'pull' | 'push' | 'switch' | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const branchNameRef = useRef<HTMLButtonElement>(null)

  const handleGitAction = useCallback(
    async (action: 'fetch' | 'pull' | 'push') => {
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
    },
    [api, gitPath, onRefresh]
  )

  const handleBranchSwitch = useCallback(
    async (name: string) => {
      setLoading('switch')
      setShowDropdown(false)
      try {
        await api.git.switchBranch(gitPath, name)
        onRefresh?.()
      } catch (err) {
        api.notification.show(
          'Branch Switch Failed',
          err instanceof Error ? err.message : 'Failed to switch branch'
        )
      } finally {
        setLoading(null)
      }
    },
    [api, gitPath, onRefresh]
  )

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-primary" strokeWidth={1.5} />
        <button
          ref={branchNameRef}
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={loading !== null}
          className="text-[13px] text-fg font-medium truncate flex-1 text-left hover:text-primary transition-colors cursor-pointer"
          title="Click to switch branches"
        >
          {loading === 'switch' ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Switching...
            </span>
          ) : (
            branch.name
          )}
        </button>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleGitAction('fetch')}
            disabled={loading !== null}
            className={btnIcon}
            title="Fetch"
          >
            {loading === 'fetch' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
            )}
          </button>
          <button
            onClick={() => handleGitAction('pull')}
            disabled={loading !== null || !branch.upstream}
            className={btnIcon}
            title={
              !branch.upstream
                ? 'No upstream branch configured'
                : `Pull${branch.behind > 0 ? ` (${branch.behind} behind)` : ''}`
            }
          >
            {loading === 'pull' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowDown
                className={`w-3.5 h-3.5 ${branch.behind > 0 ? 'text-warning' : ''}`}
                strokeWidth={1.5}
              />
            )}
          </button>
          <button
            onClick={() => handleGitAction('push')}
            disabled={loading !== null || !branch.upstream || branch.ahead === 0}
            className={btnIcon}
            title={
              !branch.upstream
                ? 'No upstream branch configured'
                : `Push${branch.ahead > 0 ? ` (${branch.ahead} ahead)` : ''}`
            }
          >
            {loading === 'push' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowUp
                className={`w-3.5 h-3.5 ${branch.ahead > 0 ? 'text-success' : ''}`}
                strokeWidth={1.5}
              />
            )}
          </button>
        </div>
      </div>

      {showDropdown && (
        <BranchDropdown
          gitPath={gitPath}
          currentBranch={branch.name}
          triggerRef={branchNameRef}
          onClose={() => setShowDropdown(false)}
          onSwitch={handleBranchSwitch}
        />
      )}
    </div>
  )
}

type SectionType = 'staged' | 'modified' | 'untracked' | 'conflicted'

function FileChangeSection({
  title,
  files,
  expanded,
  onToggle,
  variant,
  sectionType,
  gitPath,
  projectId,
  withOperation,
}: {
  title: string
  files: GitFileChange[]
  expanded: boolean
  onToggle: () => void
  variant: 'success' | 'warning' | 'error' | 'muted'
  sectionType: SectionType
  gitPath: string
  projectId: string
  withOperation: (fn: () => Promise<void>) => Promise<boolean>
}) {
  const api = getElectronAPI()
  const setDiscardingFiles = useProjectStore((s) => s.setDiscardingFiles)
  const closeWorkingTreeDiffTabs = useProjectStore((s) => s.closeWorkingTreeDiffTabs)

  const colorClass = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-danger',
    muted: 'text-fg-muted',
  }[variant]

  const handleStageAll = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const filePaths = files.map((f) => f.path)
      const ok = await withOperation(() => api.git.stageFiles(gitPath, filePaths))
      if (ok) closeWorkingTreeDiffTabs(filePaths)
    },
    [api, gitPath, files, withOperation, closeWorkingTreeDiffTabs]
  )

  const handleUnstageAll = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const filePaths = files.map((f) => f.path)
      const ok = await withOperation(() => api.git.unstageFiles(gitPath, filePaths))
      if (ok) closeWorkingTreeDiffTabs(filePaths)
    },
    [api, gitPath, files, withOperation, closeWorkingTreeDiffTabs]
  )

  const handleDiscardAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setDiscardingFiles({
        files: files.map((f) => f.path),
        isUntracked: sectionType === 'untracked',
      })
    },
    [files, sectionType, setDiscardingFiles]
  )

  return (
    <div className="border-t border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-raised transition-colors group"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-fg-faint" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="w-4 h-4 text-fg-faint" strokeWidth={1.5} />
        )}
        <span className={`eyebrow ${colorClass}`}>{title}</span>
        <span className="font-mono text-[11px] text-fg-muted tnum">{files.length}</span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {sectionType === 'staged' && (
            <button onClick={handleUnstageAll} className={btnIcon} title="Unstage All">
              <Minus className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
          {(sectionType === 'modified' || sectionType === 'untracked') && (
            <button onClick={handleStageAll} className={btnIcon} title="Stage All">
              <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
          {(sectionType === 'modified' || sectionType === 'untracked') && (
            <button
              onClick={handleDiscardAll}
              className={btnIcon}
              title={
                sectionType === 'untracked' ? 'Delete All Untracked Files' : 'Discard All Changes'
              }
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </button>
      {expanded && (
        <div className="pb-1">
          {files.map((file) => (
            <FileChangeItem
              key={file.path}
              file={file}
              variant={variant}
              sectionType={sectionType}
              gitPath={gitPath}
              projectId={projectId}
              withOperation={withOperation}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileChangeItem({
  file,
  variant,
  sectionType,
  gitPath,
  projectId,
  withOperation,
}: {
  file: GitFileChange
  variant: 'success' | 'warning' | 'error' | 'muted'
  sectionType: SectionType
  gitPath: string
  projectId: string
  withOperation: (fn: () => Promise<void>) => Promise<boolean>
}) {
  const api = getElectronAPI()
  const openWorkingTreeDiffTab = useProjectStore((s) => s.openWorkingTreeDiffTab)
  const closeWorkingTreeDiffTabs = useProjectStore((s) => s.closeWorkingTreeDiffTabs)
  const setDiscardingFiles = useProjectStore((s) => s.setDiscardingFiles)

  const Icon = {
    modified: FileEdit,
    added: FilePlus,
    deleted: FileX,
    renamed: FileEdit,
    untracked: FilePlus,
    conflicted: AlertCircle,
  }[file.status]

  const colorClass = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-danger',
    muted: 'text-fg-muted',
  }[variant]

  const fileName = file.path.split(/[/\\]/).pop() || file.path

  const handleStage = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const ok = await withOperation(() => api.git.stageFiles(gitPath, [file.path]))
      if (ok) closeWorkingTreeDiffTabs([file.path])
    },
    [api, gitPath, file.path, withOperation, closeWorkingTreeDiffTabs]
  )

  const handleUnstage = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const ok = await withOperation(() => api.git.unstageFiles(gitPath, [file.path]))
      if (ok) closeWorkingTreeDiffTabs([file.path])
    },
    [api, gitPath, file.path, withOperation, closeWorkingTreeDiffTabs]
  )

  const handleDiscard = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setDiscardingFiles({
        files: [file.path],
        isUntracked: sectionType === 'untracked',
      })
    },
    [file.path, sectionType, setDiscardingFiles]
  )

  const handleClick = useCallback(() => {
    let diffKind: 'staged' | 'unstaged' | 'untracked' | 'deleted'
    if (sectionType === 'staged') {
      diffKind = 'staged'
    } else if (sectionType === 'untracked') {
      diffKind = 'untracked'
    } else if (file.status === 'deleted') {
      diffKind = 'deleted'
    } else {
      diffKind = 'unstaged'
    }
    openWorkingTreeDiffTab(file.path, fileName, diffKind, projectId)
  }, [sectionType, file.status, file.path, fileName, projectId, openWorkingTreeDiffTab])

  return (
    <div
      className="flex items-center gap-2 h-7 px-3 ml-4 text-[12.5px] hover:bg-raised rounded-md transition-colors min-w-0 group cursor-pointer"
      title={file.path}
      onClick={handleClick}
    >
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${colorClass}`} strokeWidth={1.5} />
      <span className="text-fg truncate min-w-0 flex-1">{fileName}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {sectionType === 'staged' && (
          <button onClick={handleUnstage} className={btnIcon} title="Unstage">
            <Minus className="w-3 h-3" strokeWidth={1.5} />
          </button>
        )}
        {sectionType === 'modified' && (
          <>
            <button onClick={handleStage} className={btnIcon} title="Stage">
              <Plus className="w-3 h-3" strokeWidth={1.5} />
            </button>
            <button onClick={handleDiscard} className={btnIcon} title="Discard Changes">
              <X className="w-3 h-3" strokeWidth={1.5} />
            </button>
          </>
        )}
        {sectionType === 'untracked' && (
          <>
            <button onClick={handleStage} className={btnIcon} title="Stage">
              <Plus className="w-3 h-3" strokeWidth={1.5} />
            </button>
            <button onClick={handleDiscard} className={btnIcon} title="Delete File">
              <X className="w-3 h-3" strokeWidth={1.5} />
            </button>
          </>
        )}
        {sectionType === 'conflicted' && (
          <button onClick={handleStage} className={btnIcon} title="Mark as Resolved">
            <CheckCircle className="w-3 h-3" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  )
}
