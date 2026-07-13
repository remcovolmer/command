import type { TerminalState } from '../types'

// State dot colors for terminal indicators.
// One palette for the whole app: the --status-* tokens (src/index.css) are
// per-theme tuned and also drive the sidebar rail/chip/rollup treatments.
export const STATE_DOT_COLORS: Record<TerminalState, string> = {
  busy: 'bg-[var(--status-busy)]',
  permission: 'bg-[var(--status-attention)]',
  question: 'bg-[var(--status-attention)]',
  done: 'bg-[var(--status-done)]',
  stopped: 'bg-[var(--status-stopped)]',
}

// Same palette as text color, for tinting the agent logo by state (the logo
// doubles as the status indicator, so no separate dot is needed).
export const STATE_TEXT_COLORS: Record<TerminalState, string> = {
  busy: 'text-[var(--status-busy)]',
  permission: 'text-[var(--status-attention)]',
  question: 'text-[var(--status-attention)]',
  done: 'text-[var(--status-done)]',
  stopped: 'text-[var(--status-stopped)]',
}

// States that require user input (show blinking indicator)
export const INPUT_STATES = ['done', 'permission', 'question'] as const
export const isInputState = (state: TerminalState): boolean =>
  INPUT_STATES.includes(state as (typeof INPUT_STATES)[number])

// States that require urgent user attention (orange treatment in sidebar)
export const ATTENTION_STATES = ['permission', 'question'] as const
export const isAttentionState = (state: TerminalState): boolean =>
  ATTENTION_STATES.includes(state as (typeof ATTENTION_STATES)[number])

// States that should show a visible indicator
export const VISIBLE_STATES = ['busy', 'done', 'permission', 'question'] as const
export const isVisibleState = (state: TerminalState): boolean =>
  VISIBLE_STATES.includes(state as (typeof VISIBLE_STATES)[number])

// Helper function for state colors (used by SidecarTerminalPanel)
export function getStateColor(state: TerminalState): string {
  return STATE_DOT_COLORS[state] ?? 'bg-muted-foreground'
}
