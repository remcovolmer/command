/** @vitest-environment jsdom */

import { beforeEach, describe, expect, test } from 'vitest'
import { buildTerminalThemeOptions, invalidateTerminalThemeCache } from '../src/utils/terminalTheme'

describe('terminal theme options', () => {
  beforeEach(() => {
    invalidateTerminalThemeCache()
    document.documentElement.style.setProperty('--sidebar', '#f8f7f4')
    document.documentElement.style.setProperty('--sidebar-foreground', '#3f3f3f')
    document.documentElement.style.setProperty('--primary', '#b56032')
    document.documentElement.style.setProperty('--muted-foreground', '#8c8c8c')
    document.documentElement.style.setProperty('--sidebar-accent', '#ece9e3')
    document.documentElement.style.setProperty('--background', '#fcfbf8')
  })

  test('enforces WCAG AA contrast for terminal application colors', () => {
    const options = buildTerminalThemeOptions('light')

    expect(options.minimumContrastRatio).toBe(4.5)
    expect(options.theme?.background).toBe('#f8f7f4')
  })
})
