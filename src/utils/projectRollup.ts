import type { TerminalSession } from '../types'
import { isAttentionState } from './terminalState'
import { isAgentType } from '@shared/agents'

// Highest-priority child status for a collapsed project row.
// Priority: attention (permission/question) > done > busy; 'stopped' never contributes.
// Only agent chats count: sidecar 'normal' shells sit permanently in 'done' and
// never update, so including them would keep the rollup green forever.
export type ProjectRollupState = 'attention' | 'done' | 'busy' | null

export function getProjectRollupState(terminals: TerminalSession[]): ProjectRollupState {
  let hasDone = false
  let hasBusy = false

  for (const terminal of terminals) {
    if (!isAgentType(terminal.type)) continue
    if (isAttentionState(terminal.state)) return 'attention'
    if (terminal.state === 'done') hasDone = true
    else if (terminal.state === 'busy') hasBusy = true
  }

  if (hasDone) return 'done'
  if (hasBusy) return 'busy'
  return null
}
