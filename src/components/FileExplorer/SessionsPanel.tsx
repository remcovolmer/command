import { GitBranch, Clock } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import {
  STATE_DOT_COLORS,
} from '../../utils/terminalState'

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return new Date(ts).toLocaleDateString()
}

export function SessionsPanel() {
  const activeTerminalId = useProjectStore((s) => s.activeTerminalId)
  const terminals = useProjectStore((s) => s.terminals)

  const terminal = activeTerminalId ? terminals[activeTerminalId] : null

  // Don't render anything if no active claude terminal
  if (!terminal || terminal.type !== 'claude') return null

  return (
    <div className="px-2 py-2 border-b border-border bg-sidebar-accent/50 shrink-0">
      {/* State + title row */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_DOT_COLORS[terminal.state]}`} />
        <span className="text-xs font-medium text-sidebar-foreground truncate flex-1">
          {terminal.title}
        </span>
        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {formatRelativeTime(terminal.lastActivity)}
        </span>
      </div>

      {/* Summary */}
      {terminal.summary && (
        <p className="text-[11px] text-muted-foreground leading-snug truncate">
          {terminal.summary}
        </p>
      )}

      {/* Branch */}
      {terminal.worktreeId && (
        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
          <GitBranch className="w-2.5 h-2.5" />
          <span className="truncate">{terminal.worktreeId.slice(0, 8)}...</span>
        </div>
      )}
    </div>
  )
}
