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

export function TerminalListItem({
  terminal,
  isActive,
  onSelect,
  onClose,
  className,
}: TerminalListItemProps) {
  const defaultClassName = `
    group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm
    ${isActive
      ? 'bg-sidebar-accent text-sidebar-foreground'
      : 'text-muted-foreground hover:bg-muted/50 hover:text-sidebar-foreground'}
  `
  return (
    <li
      onClick={onSelect}
      className={className ?? defaultClassName}
    >
      <TerminalIcon
        className={`w-3 h-3 flex-shrink-0 ${STATE_TEXT_COLORS[terminal.state]}`}
      />
      <span className="flex-1 text-xs truncate">{terminal.title}</span>
      {/* State indicator - shows for busy (static) and input states (blinking) */}
      {isVisibleState(terminal.state) && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${STATE_DOT_COLORS[terminal.state]} ${
            isInputState(terminal.state) ? `needs-input-indicator state-${terminal.state}` : ''
          }`}
        />
      )}
      <button
        onClick={onClose}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
        title="Close Terminal"
      >
        <X className="w-3 h-3" />
      </button>
    </li>
  )
}
