import { memo } from 'react'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import type { TerminalSession } from '../../types'
import {
  STATE_DOT_COLORS,
  isAttentionState,
  isInputState,
  isVisibleState,
} from '../../utils/terminalState'
import { AttentionChip, AttentionRail, attentionRowBg } from './AttentionRail'

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
  const defaultClassName = `
    group flex items-center gap-2 px-3 py-1.5 cursor-pointer
    transition-colors duration-150 rounded-md
    ${attentionRowBg(isAttention, isActive)}
    ${isActive ? 'text-sidebar-foreground' : 'text-muted-foreground hover:text-sidebar-foreground'}
  `
  const isClaude = terminal.type === 'claude'
  const showSummary = isClaude && isActive && Boolean(terminal.summary)

  return (
    <li
      onClick={onSelect}
      className={`relative ${className ?? defaultClassName}`}
      title={isClaude && !isActive && terminal.summary ? terminal.summary : undefined}
    >
      {isAttention && <AttentionRail />}
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
      {isAttention && <AttentionChip />}
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
