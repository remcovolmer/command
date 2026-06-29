import { useEffect, useRef } from 'react'
import { TerminalIcon, Plus, Globe, X } from 'lucide-react'
import type { TerminalSession } from '../../types'
import { STATE_DOT_COLORS, isInputState } from '../../utils/terminalState'

interface TerminalTabBarProps {
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onSelect: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onAdd: () => void
  onOpenBrowser: () => void
  canAdd: boolean
}

export function TerminalTabBar({
  terminals,
  activeTerminalId,
  onSelect,
  onClose,
  onAdd,
  onOpenBrowser,
  canAdd,
}: TerminalTabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll active tab into view when it changes
  useEffect(() => {
    if (!activeTerminalId || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-tab-id="${activeTerminalId}"]`)
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeTerminalId])

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 px-3 py-1.5 bg-sidebar-accent border-b border-border overflow-x-auto scroll-hidden"
    >
      {terminals.map((terminal) => {
        const isActive = terminal.id === activeTerminalId

        return (
          <div
            key={terminal.id}
            data-tab-id={terminal.id}
            onClick={() => onSelect(terminal.id)}
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
            <TerminalIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs font-medium whitespace-nowrap">
              {terminal.generatedTitle || terminal.title}
            </span>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_DOT_COLORS[terminal.state]} ${
                isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
              }`}
            />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(terminal.id)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}

      {canAdd && (
        <button
          onClick={onAdd}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 transition-colors"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
      <button
        onClick={onOpenBrowser}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 transition-colors"
        title="Open browser tab"
      >
        <Globe className="w-4 h-4" />
      </button>
    </div>
  )
}
