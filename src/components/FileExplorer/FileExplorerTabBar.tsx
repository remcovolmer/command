import { FolderTree, GitBranch, RefreshCw } from 'lucide-react'

interface FileExplorerTabBarProps {
  activeTab: 'files' | 'git'
  onTabChange: (tab: 'files' | 'git') => void
  gitChangeCount: number
  isGitLoading: boolean
  onRefresh: () => void
}

export function FileExplorerTabBar({
  activeTab,
  onTabChange,
  gitChangeCount,
  isGitLoading,
  onRefresh,
}: FileExplorerTabBarProps) {
  const tabs = [
    { id: 'files' as const, label: 'Files', icon: FolderTree },
    { id: 'git' as const, label: 'Git', icon: GitBranch, badge: gitChangeCount },
  ]

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
                flex items-center gap-1.5 px-2 py-1 rounded text-sm
                transition-colors
                ${isActive
                  ? 'bg-sidebar text-sidebar-foreground'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1 py-0.5 rounded">
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
