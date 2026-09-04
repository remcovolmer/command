import type { CSSProperties } from 'react'
import type { TerminalState } from '../../types'
import { STATE_DOT_COLORS, isAttentionState } from '../../utils/terminalState'

// Busy needs a gradient sweep (background + background-size + animation) that
// isn't expressible as a static Tailwind utility, so it's applied as inline
// style rather than through stateLineClass. Only opacity/background-position
// animate (compositor-friendly, same discipline as .attention-pulse).
const BUSY_STYLE: CSSProperties = {
  background:
    'linear-gradient(90deg, transparent, color-mix(in oklch, var(--status-busy) 55%, transparent), transparent)',
  backgroundSize: '40% 100%',
  animation: 'state-line-sweep 2.4s linear infinite',
}

/**
 * Pure mapping from terminal state to the state-line's Tailwind classes.
 * Exported for direct unit testing (test/stateLine.test.tsx) — busy is
 * intentionally excluded (returns ''); its look comes from BUSY_STYLE above.
 */
export function stateLineClass(state: TerminalState | null): string {
  if (state === null) return 'bg-transparent'
  if (state === 'busy') return ''
  // Same color map and attention grouping as the sidebar dots/rail, so the
  // line can never disagree with the badge about the same chat's status.
  return isAttentionState(state)
    ? `${STATE_DOT_COLORS[state]} attention-pulse`
    : STATE_DOT_COLORS[state]
}

interface StateLineProps {
  state: TerminalState | null
}

/**
 * The signature 2px line under the chat tab bar, directly above the terminal
 * screen. Carries the active chat's state so you don't have to look away from
 * the terminal to know whether it needs you — see "Het signatuurelement" in
 * docs/plan/2026-09-04-design-overhaul.html. Reduced-motion handling lives in
 * index.css (`.state-line { animation: none }` under prefers-reduced-motion).
 */
export function StateLine({ state }: StateLineProps) {
  return (
    <div
      aria-hidden="true"
      className={`state-line h-0.5 shrink-0 ${stateLineClass(state)}`}
      style={state === 'busy' ? BUSY_STYLE : undefined}
    />
  )
}
