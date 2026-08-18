import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The terminal gutter must sit on the .xterm element, never on the
 * .terminal-container that xterm is opened into.
 *
 * FitAddon computes the available space as
 *   getComputedStyle(terminal.element.parentElement).height - padding(terminal.element)
 * With Tailwind's `box-sizing: border-box`, the parent's computed height already
 * includes the parent's own padding, so padding on .terminal-container is never
 * subtracted: fit() over-estimates by the padding and proposes up to one extra
 * row and two extra cols, whose glyphs then render outside the visible area —
 * the bottom row shows as a half row.
 */
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf-8')

function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `rule "${selector}" not found in src/index.css`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

describe('terminal gutter padding', () => {
  test('.terminal-container declares no padding (FitAddon cannot subtract it)', () => {
    expect(ruleBody('.terminal-container')).not.toMatch(/padding/)
  })

  test('.terminal-container .xterm carries the gutter padding', () => {
    expect(ruleBody('.terminal-container .xterm')).toMatch(/padding:\s*8px/)
  })
})
