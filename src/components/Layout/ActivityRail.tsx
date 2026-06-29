import { FolderTree, GitBranch, ListChecks, Zap } from 'lucide-react'
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
    </div>
  )
}
