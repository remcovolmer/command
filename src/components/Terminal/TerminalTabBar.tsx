import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import type { TerminalSession } from '../../types'
import { AgentBadge } from '../AgentBadge'

interface TerminalTabBarProps {
  terminals: TerminalSession[]
  activeTerminalId: string | null
  onSelect: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onAdd: () => void
  canAdd: boolean
}

export function TerminalTabBar({
  terminals,
  activeTerminalId,
  onSelect,
  onClose,
  onAdd,
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
      className="flex items-end gap-0.5 px-2 h-9 bg-canvas border-b border-border overflow-x-auto scroll-hidden"
    >
      {terminals.map((terminal) => {
        const isActive = terminal.id === activeTerminalId

        return (
          <div
            key={terminal.id}
            data-tab-id={terminal.id}
            onClick={() => onSelect(terminal.id)}
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
            {/* The agent logo is tinted by state (green=done, gray=busy,
                orange=needs input, red=stopped) — it is the status indicator, so
                no separate dot. */}
            <AgentBadge type={terminal.type} state={terminal.state} />
            <span className="font-medium whitespace-nowrap">
              {terminal.generatedTitle || terminal.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(terminal.id)
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-raised transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}

      {canAdd && (
        <button
          onClick={onAdd}
          className="w-7 h-7 mb-1 rounded-md flex items-center justify-center text-fg-faint hover:text-fg hover:bg-raised transition-colors"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
