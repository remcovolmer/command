/** @vitest-environment jsdom */

import { beforeEach, describe, expect, test } from 'vitest'
import {
  buildTerminalThemeOptions,
  getCssVar,
  invalidateTerminalThemeCache,
} from '../src/utils/terminalTheme'

describe('terminal theme options', () => {
  beforeEach(() => {
    invalidateTerminalThemeCache()
    document.documentElement.style.setProperty('--screen', '#f8f7f4')
    document.documentElement.style.setProperty('--fg', '#3f3f3f')
    document.documentElement.style.setProperty('--primary', '#b56032')
    document.documentElement.style.setProperty('--fg-faint', '#8c8c8c')
    document.documentElement.style.setProperty('--fg-strong', '#1a1a1a')
    document.documentElement.style.setProperty('--canvas', '#ece9e3')
    document.documentElement.style.setProperty('--terminal-selection', '#d8c9bd')
  })

  test('enforces WCAG AA contrast for terminal application colors', () => {
    const options = buildTerminalThemeOptions('light')

    expect(options.minimumContrastRatio).toBe(4.5)
    expect(options.theme?.background).toBe('#f8f7f4')
    expect(options.theme?.foreground).toBe('#3f3f3f')
    expect(options.theme?.cursor).toBe('#b56032')
  })

  test('picks the dark ANSI palette when the app theme is dark', () => {
    const options = buildTerminalThemeOptions('dark')

    expect(options.theme?.red).toBe('#e06c6c')
  })

  test('picks the light ANSI palette when the app theme is light', () => {
    const options = buildTerminalThemeOptions('light')

    expect(options.theme?.red).toBe('#b83f36')
  })
})

describe('getCssVar', () => {
  test('passes through an already-hex value unchanged', () => {
    document.documentElement.style.setProperty('--test-hex', '#123abc')

    expect(getCssVar('--test-hex')).toBe('#123abc')
  })

  test('parses a computed rgb(r, g, b) value into hex', () => {
    // jsdom's getComputedStyle resolves a plain CSS color keyword to
    // rgb(r, g, b) — this exercises the regex path getCssVar falls back to
    // for any non-hex value (oklch, color-mix, named colors, …).
    document.documentElement.style.setProperty('--test-named', 'red')

    expect(getCssVar('--test-named')).toBe('#ff0000')
  })
})
