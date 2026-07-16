import { memo, useCallback, useState } from 'react'
import { Terminal as TerminalIcon, X, Zap } from 'lucide-react'
import type { AgentType, TerminalSession } from '../../types'
import { isAttentionState } from '../../utils/terminalState'
import { AttentionChip, AttentionRail, attentionRowBg } from './AttentionRail'
import { AgentBadge } from '../AgentBadge'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { AGENT_DISPLAY, AGENT_IDS, isAgentType } from '@shared/agents'

interface TerminalListItemProps {
  terminal: TerminalSession
  isActive: boolean
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  /** Switch this chat to another agent (closes it and restarts with the chosen agent). */
  onSwitchAgent?: (agent: AgentType) => void
  className?: string // Optional custom container styles
}

export const TerminalListItem = memo(function TerminalListItem({
  terminal,
  isActive,
  onSelect,
  onClose,
  onSwitchAgent,
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
  const isAutomation = terminal.origin === 'automation'

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const canSwitch = Boolean(onSwitchAgent) && isAgentType(terminal.type)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!canSwitch) return
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({ x: e.clientX, y: e.clientY })
    },
    [canSwitch]
  )

  const agentItems: ContextMenuEntry[] = canSwitch
    ? AGENT_IDS.filter((a) => a !== terminal.type).map((a) => ({
        label: `Switch to ${AGENT_DISPLAY[a].label}`,
        onClick: () => onSwitchAgent?.(a),
      }))
    : []

  return (
    <>
      <li
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={`relative ${className ?? defaultClassName} ${isAutomation ? 'automation-spawn' : ''}`}
        title={isClaude && !isActive && terminal.summary ? terminal.summary : undefined}
      >
        {isAttention && <AttentionRail />}
        {/* The agent's brand mark is the row icon AND the status indicator: it is
            tinted by state (green=done, gray=busy, orange=needs input, red=stopped),
            so there is no separate dot. Non-agent shells keep the generic glyph. */}
        {isAgentType(terminal.type) ? (
          <AgentBadge type={terminal.type} state={terminal.state} />
        ) : (
          <TerminalIcon
            className={`w-3 h-3 flex-shrink-0 ${
              terminal.state === 'stopped'
                ? 'text-[var(--status-stopped)]'
                : 'text-muted-foreground'
            }`}
          />
        )}
        {/* Origin marker: this chat/worktree was started by an automation (R22). */}
        {isAutomation && (
          <Zap className="w-3 h-3 flex-shrink-0 text-primary" aria-label="Started by an automation" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-xs truncate block">
            {terminal.generatedTitle || terminal.title}
          </span>
          {showSummary && (
            <span className="text-[10px] text-muted-foreground truncate block leading-tight opacity-70">
              {terminal.summary}
            </span>
          )}
        </div>
        {/* Attention chip - permission/question rows say what they need. The
            busy/done state now lives in the logo tint (above), so no state dot. */}
        {isAttention && <AttentionChip />}
        <button
          onClick={onClose}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity flex-shrink-0"
          title="Close Chat"
        >
          <X className="w-3 h-3" />
        </button>
      </li>
      {contextMenu && agentItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={agentItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
})
