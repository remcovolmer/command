import type { TerminalSession } from '../types'
import { isAttentionState } from './terminalState'

// Highest-priority child status for a collapsed project row.
// Priority: attention (permission/question) > done > busy; 'stopped' never contributes.
export type ProjectRollupState = 'attention' | 'done' | 'busy' | null

export function getProjectRollupState(terminals: TerminalSession[]): ProjectRollupState {
  let hasDone = false
  let hasBusy = false

  for (const terminal of terminals) {
    if (isAttentionState(terminal.state)) return 'attention'
    if (terminal.state === 'done') hasDone = true
    else if (terminal.state === 'busy') hasBusy = true
  }

  if (hasDone) return 'done'
  if (hasBusy) return 'busy'
  return null
}
