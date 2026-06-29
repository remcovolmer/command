import { FolderTree, GitBranch, ListChecks, Zap, TerminalSquare, Globe } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'

type ExplorerTab = 'files' | 'git' | 'tasks' | 'automations'

const ITEMS: { tab: ExplorerTab; icon: typeof FolderTree; label: string }[] = [
  { tab: 'files', icon: FolderTree, label: 'Files' },
  { tab: 'git', icon: GitBranch, label: 'Git' },
  { tab: 'tasks', icon: ListChecks, label: 'Tasks' },
  { tab: 'automations', icon: Zap, label: 'Automations' },
]

/**
 * Activity bar on the far right. Each icon opens the file-explorer flyout to its
 * tab; clicking the active icon again closes the flyout. The flyout itself is an
 * auto-closing overlay (click-outside closes it) rendered by MainLayout.
 */
export function ActivityRail() {
  const visible = useProjectStore((s) => s.fileExplorerVisible)
  const activeTab = useProjectStore((s) => s.fileExplorerActiveTab)
  const setActiveTab = useProjectStore((s) => s.setFileExplorerActiveTab)
  const setVisible = useProjectStore((s) => s.setFileExplorerVisible)

  // Shell-drawer toggle state (scoped to the active chat's worktree-context).
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeWorktree = useProjectStore((s) => {
    const term = s.activeTerminalId ? s.terminals[s.activeTerminalId] : null
    return term?.worktreeId ? s.worktrees[term.worktreeId] : null
  })
  const shellContextKey = activeWorktree?.id ?? activeProjectId
  const shellCount = useProjectStore((s) =>
    shellContextKey ? (s.sidecarTerminals[shellContextKey]?.length ?? 0) : 0
  )
  const hasShells = shellCount > 0
  const shellCollapsed = useProjectStore((s) => s.sidecarTerminalCollapsed)
  const toggleShellDrawer = useProjectStore((s) => s.toggleShellDrawer)
  const openBrowserTab = useProjectStore((s) => s.openBrowserTab)

  const handleOpenBrowser = () => {
    if (activeProjectId) openBrowserTab(activeProjectId)
  }

  const handleClick = (tab: ExplorerTab) => {
    if (visible && activeTab === tab) {
      setVisible(false)
    } else {
      setActiveTab(tab)
      setVisible(true)
    }
  }

  return (
    <div
      data-activity-rail
      className="flex flex-col items-center w-12 bg-sidebar border-l border-border py-2 gap-1 shrink-0"
    >
      {/* Open browser tab — content action, sits above the panel icons */}
      <button
        onClick={handleOpenBrowser}
        title="Open browser tab"
        className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50"
      >
        <Globe className="w-[18px] h-[18px]" />
      </button>
      <div className="w-5 h-px bg-border my-1" />

      {ITEMS.map(({ tab, icon: Icon, label }) => {
        const active = visible && activeTab === tab
        return (
          <button
            key={tab}
            onClick={() => handleClick(tab)}
            title={label}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              active
                ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground'
                : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
            }`}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        )
      })}

      {/* Shell-drawer toggle at the foot of the rail */}
      <button
        onClick={toggleShellDrawer}
        title={hasShells ? `${shellCount} shell${shellCount === 1 ? '' : 's'}` : 'Open shell'}
        className={`relative mt-auto w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          hasShells && !shellCollapsed
            ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground'
            : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
        }`}
      >
        <TerminalSquare className="w-[18px] h-[18px]" />
        {hasShells && shellCollapsed && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold leading-[15px] text-center">
            {shellCount}
          </span>
        )}
      </button>
    </div>
  )
}
