import { memo } from 'react'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import type { TerminalSession } from '../../types'
import {
  STATE_DOT_COLORS,
  isAttentionState,
  isInputState,
  isVisibleState,
} from '../../utils/terminalState'

interface TerminalListItemProps {
  terminal: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  className?: string // Optional custom container styles
}

export const TerminalListItem = memo(function TerminalListItem({
  terminal,
  isActive,
  onSelect,
  onClose,
  className,
}: TerminalListItemProps) {
  const isAttention = isAttentionState(terminal.state)
  const activeBg = isAttention
    ? 'bg-[color-mix(in_oklch,var(--status-attention)_14%,var(--sidebar-highlight))]'
    : 'bg-[var(--sidebar-highlight)]'
  const inactiveBg = isAttention
    ? 'bg-[color-mix(in_oklch,var(--status-attention)_8%,transparent)]'
    : 'hover:bg-muted/50'
  const defaultClassName = `
    group flex items-center gap-2 px-3 py-1.5 cursor-pointer
    transition-colors duration-150 rounded-md
    ${isActive
      ? `${activeBg} text-sidebar-foreground`
      : `${inactiveBg} text-muted-foreground hover:text-sidebar-foreground`}
  `
  const isClaude = terminal.type === 'claude'
  const showSummary = isClaude && isActive && Boolean(terminal.summary)

  return (
    <li
      onClick={onSelect}
      className={`relative ${className ?? defaultClassName}`}
      title={isClaude && !isActive && terminal.summary ? terminal.summary : undefined}
    >
      {/* Attention rail - 3px left-edge bar for permission/question (pulse lives on the rail) */}
      {isAttention && (
        <span
          data-testid="attention-rail"
          aria-hidden="true"
          className="attention-rail absolute inset-y-0 left-0 w-[3px] rounded-full bg-[var(--status-attention)] pointer-events-none"
        />
      )}
      <TerminalIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <span className="text-xs truncate block">{terminal.generatedTitle || terminal.title}</span>
        {showSummary && (
          <span className="text-[10px] text-muted-foreground truncate block leading-tight opacity-70">
            {terminal.summary}
          </span>
        )}
      </div>
      {/* Attention chip - permission/question rows say what they need */}
      {isAttention && (
        <span className="text-[10px] leading-none font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap bg-[color-mix(in_oklch,var(--status-attention)_18%,transparent)] text-[var(--status-attention)]">
          wacht op jou
        </span>
      )}
      {/* State dot - only for visible non-attention states (busy static, done blinking) */}
      {!isAttention && isVisibleState(terminal.state) && (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_DOT_COLORS[terminal.state]} ${
            isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
          }`}
        />
      )}
      <button
        onClick={onClose}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity flex-shrink-0"
        title="Close Chat"
      >
        <X className="w-3 h-3" />
      </button>
    </li>
  )
})
