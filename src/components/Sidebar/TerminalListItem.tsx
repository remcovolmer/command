import { memo } from 'react'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import type { TerminalSession } from '../../types'
import {
  STATE_TEXT_COLORS,
  STATE_DOT_COLORS,
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
  const defaultClassName = `
    group flex items-center gap-2 px-3 py-1.5 cursor-pointer
    transition-colors duration-150
    ${isActive
      ? 'bg-[var(--sidebar-highlight)] text-sidebar-foreground rounded-md'
      : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50 rounded-md'}
  `
  const isClaude = terminal.type === 'claude'

  return (
    <li
      onClick={onSelect}
      className={className ?? defaultClassName}
    >
      <TerminalIcon
        className={`w-3 h-3 flex-shrink-0 ${isClaude ? 'mt-0.5' : ''} ${STATE_TEXT_COLORS[terminal.state]}`}
      />
      <div className="flex-1 min-w-0">
        <span className="text-xs truncate block">{terminal.title}</span>
        {isClaude && (
          <span className="text-[10px] text-text-secondary truncate block leading-tight opacity-70">
            {terminal.summary || '\u00A0'}
          </span>
        )}
      </div>
      {/* State indicator - shows for busy (static) and input states (blinking) */}
      {isVisibleState(terminal.state) && (
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
