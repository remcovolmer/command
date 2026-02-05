import type { TerminalState } from '../../types'

// Claude Code terminal state colors
export const TERMINAL_STATE_COLORS: Record<TerminalState, string> = {
  busy: 'text-blue-500',
  permission: 'text-orange-500',
  question: 'text-orange-500',
  done: 'text-green-500',
  stopped: 'text-red-500',
}

export const TERMINAL_STATE_DOTS: Record<TerminalState, string> = {
  busy: 'bg-blue-500',
  permission: 'bg-orange-500',
  question: 'bg-orange-500',
  done: 'bg-green-500',
  stopped: 'bg-red-500',
}

// States that require user input (show blinking indicator)
const INPUT_STATES = ['done', 'permission', 'question'] as const
export const isInputState = (state: TerminalState): boolean =>
  INPUT_STATES.includes(state as typeof INPUT_STATES[number])

// States that should show an indicator (busy shows static, input states blink)
const VISIBLE_STATES = ['busy', 'done', 'permission', 'question'] as const
export const isVisibleState = (state: TerminalState): boolean =>
  VISIBLE_STATES.includes(state as typeof VISIBLE_STATES[number])
