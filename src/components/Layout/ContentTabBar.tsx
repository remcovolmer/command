import { useEffect, useRef } from 'react'
import { FileText, Circle, GitCompare, Globe, X } from 'lucide-react'
import type { CenterTab } from '../../types'

interface ContentTabBarProps {
  tabs: CenterTab[]
  activeContentId: string | null
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
}

function tabLabel(tab: CenterTab): string {
  if (tab.type === 'browser')
    return tab.fileName ?? (tab.url.replace(/^https?:\/\//, '') || 'Browser')
  if (tab.type === 'diff') return `${tab.fileName} (diff)`
  if (tab.type === 'working-tree-diff') {
    const kind =
      tab.diffKind === 'staged'
        ? 'Staged'
        : tab.diffKind === 'untracked'
          ? 'New File'
          : tab.diffKind === 'deleted'
            ? 'Deleted'
            : 'Working Tree'
    return `${tab.fileName} (${kind})`
  }
  return tab.fileName
}

export function ContentTabBar({ tabs, activeContentId, onSelect, onClose }: ContentTabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeContentId || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-tab-id="${activeContentId}"]`)
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeContentId])

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 px-3 py-1.5 bg-sidebar-accent border-b border-border overflow-x-auto scroll-hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeContentId

        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`
              group flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer
              transition-colors select-none
              ${
                isActive
                  ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50'
              }
            `}
          >
            {tab.type === 'browser' ? (
              <Globe className="w-3.5 h-3.5 flex-shrink-0 text-purple-400" />
            ) : tab.type === 'diff' || tab.type === 'working-tree-diff' ? (
              <GitCompare className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
            ) : (
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <span className="text-xs font-medium whitespace-nowrap">{tabLabel(tab)}</span>
            {tab.type === 'editor' && tab.isDirty && (
              <Circle className="w-2 h-2 flex-shrink-0 fill-current text-orange-400" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
