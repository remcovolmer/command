import type { TerminalState } from '../types'

// State dot colors for terminal indicators
export const STATE_DOT_COLORS: Record<TerminalState, string> = {
  busy: 'bg-gray-400',
  permission: 'bg-orange-500',
  question: 'bg-orange-500',
  done: 'bg-green-500',
  stopped: 'bg-red-500',
}

// States that require user input (show blinking indicator)
export const INPUT_STATES = ['done', 'permission', 'question'] as const
export const isInputState = (state: TerminalState): boolean =>
  INPUT_STATES.includes(state as typeof INPUT_STATES[number])

// States that require urgent user attention (orange treatment in sidebar)
export const ATTENTION_STATES = ['permission', 'question'] as const
export const isAttentionState = (state: TerminalState): boolean =>
  ATTENTION_STATES.includes(state as typeof ATTENTION_STATES[number])

// States that should show a visible indicator
export const VISIBLE_STATES = ['busy', 'done', 'permission', 'question'] as const
export const isVisibleState = (state: TerminalState): boolean =>
  VISIBLE_STATES.includes(state as typeof VISIBLE_STATES[number])

// Helper function for state colors (used by SidecarTerminalPanel)
export function getStateColor(state: TerminalState): string {
  return STATE_DOT_COLORS[state] ?? 'bg-muted-foreground'
}
