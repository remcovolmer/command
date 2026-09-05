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
      className="flex items-end gap-0.5 px-2 h-9 bg-canvas border-b border-border overflow-x-auto scroll-hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeContentId

        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`
              group relative flex items-center gap-1.5 h-9 px-2.5 text-[12.5px] cursor-pointer
              select-none transition-colors
              ${isActive ? 'text-fg-strong' : 'text-fg-muted hover:text-fg'}
              ${
                isActive
                  ? 'after:absolute after:left-2 after:right-2 after:-bottom-px after:h-0.5 after:rounded-t after:bg-primary'
                  : ''
              }
            `}
          >
            {tab.type === 'browser' ? (
              <Globe className="w-3.5 h-3.5 flex-shrink-0 text-fg-muted" />
            ) : tab.type === 'diff' || tab.type === 'working-tree-diff' ? (
              <GitCompare className="w-3.5 h-3.5 flex-shrink-0 text-info" />
            ) : (
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <span className="font-medium whitespace-nowrap">{tabLabel(tab)}</span>
            {tab.type === 'editor' && tab.isDirty && (
              <Circle className="w-2 h-2 flex-shrink-0 fill-current text-warning" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-raised transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
