import { FolderTree, GitBranch, ListChecks, RefreshCw } from 'lucide-react'

type ExplorerTab = 'files' | 'git' | 'tasks'

interface FileExplorerHeaderProps {
  activeTab: ExplorerTab
  isGitLoading: boolean
  onRefresh: () => void
  worktreeBranch?: string | null
}

const TAB_META: Record<ExplorerTab, { label: string; icon: typeof FolderTree }> = {
  files: { label: 'Files', icon: FolderTree },
  git: { label: 'Git', icon: GitBranch },
  tasks: { label: 'Tasks', icon: ListChecks },
}

/**
 * Slim flyout header for the file explorer. Tab switching now lives in the
 * activity rail; this header only labels the active panel, shows the worktree
 * branch for the files context, and keeps the manual refresh control.
 */
export function FileExplorerHeader({
  activeTab,
  isGitLoading,
  onRefresh,
  worktreeBranch,
}: FileExplorerHeaderProps) {
  const { label, icon: Icon } = TAB_META[activeTab] ?? TAB_META.files
  const title = activeTab === 'files' && worktreeBranch ? `${label} · ${worktreeBranch}` : label
  const gitRefreshing = activeTab === 'git' && isGitLoading

  return (
    <div className="flex items-center justify-between px-2 py-1 bg-sidebar-accent border-b border-border shrink-0">
      <div className="flex items-center gap-1.5 px-1 min-w-0 text-xs font-medium text-sidebar-foreground">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{title}</span>
      </div>
      <button
        onClick={onRefresh}
        disabled={gitRefreshing}
        className="p-1 rounded hover:bg-muted/50 transition-colors shrink-0"
        title="Refresh"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 text-muted-foreground ${gitRefreshing ? 'animate-spin' : ''}`}
        />
      </button>
    </div>
  )
}
