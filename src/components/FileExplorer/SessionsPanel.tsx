import { GitBranch, Clock } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { STATE_DOT_COLORS } from '../../utils/terminalState'

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
  const worktrees = useProjectStore((s) => s.worktrees)

  const terminal = activeTerminalId ? terminals[activeTerminalId] : null
  const worktreeName = terminal?.worktreeId ? worktrees[terminal.worktreeId]?.name : undefined

  // Don't render anything if no active claude terminal
  if (!terminal || terminal.type !== 'claude') return null

  return (
    <div className="px-3 py-2 border-b border-border bg-canvas shrink-0">
      {/* State + title row */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_DOT_COLORS[terminal.state]}`}
        />
        <span className="text-[12.5px] font-medium text-fg-strong truncate flex-1">
          {terminal.generatedTitle || terminal.title}
        </span>
        <span className="font-mono text-[10.5px] text-fg-muted tnum flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" strokeWidth={1.5} />
          {formatRelativeTime(terminal.lastActivity)}
        </span>
      </div>

      {/* Summary */}
      {terminal.summary && (
        <p className="font-mono text-[11px] text-fg-muted leading-snug truncate">
          {terminal.summary}
        </p>
      )}

      {/* Branch */}
      {worktreeName && (
        <div className="flex items-center gap-1 mt-0.5 font-mono text-[10.5px] text-fg-muted">
          <GitBranch className="w-2.5 h-2.5" strokeWidth={1.5} />
          <span className="truncate">{worktreeName}</span>
        </div>
      )}
    </div>
  )
}
