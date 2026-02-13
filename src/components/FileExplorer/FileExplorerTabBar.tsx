import { FolderTree, GitBranch, RefreshCw } from 'lucide-react'

interface FileExplorerTabBarProps {
  activeTab: 'files' | 'git'
  onTabChange: (tab: 'files' | 'git') => void
  gitChangeCount: number
  isGitLoading: boolean
  onRefresh: () => void
  showGitTab?: boolean
}

export function FileExplorerTabBar({
  activeTab,
  onTabChange,
  gitChangeCount,
  isGitLoading,
  onRefresh,
  showGitTab = true,
}: FileExplorerTabBarProps) {
  const allTabs = [
    { id: 'files' as const, label: 'Files', icon: FolderTree },
    { id: 'git' as const, label: 'Git', icon: GitBranch, badge: gitChangeCount },
  ]
  const tabs = showGitTab ? allTabs : allTabs.filter(t => t.id !== 'git')

  return (
    <div className="flex items-center justify-between px-2 py-1 bg-sidebar-accent border-b border-border shrink-0">
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
                transition-colors
                ${isActive
                  ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="text-xs bg-primary/15 text-primary px-1 py-0.5 rounded-full">
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onRefresh}
          disabled={activeTab === 'git' && isGitLoading}
          className="p-1 rounded hover:bg-muted/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${
            activeTab === 'git' && isGitLoading ? 'animate-spin' : ''
          }`} />
        </button>
      </div>
    </div>
  )
}
