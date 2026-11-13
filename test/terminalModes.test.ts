import { describe, test, expect } from 'vitest'
import { buildModeRestoreSequence, readTerminalModes } from '../src/utils/terminalModes'

function fakeTerminal(activeEncoding: unknown, isCursorHidden: unknown) {
  return { _core: { coreMouseService: { activeEncoding }, coreService: { isCursorHidden } } }
}

describe('readTerminalModes', () => {
  test('reads SGR encoding and hidden cursor from xterm core services', () => {
    expect(readTerminalModes(fakeTerminal('SGR', true))).toEqual({
      mouseEncoding: 'SGR',
      cursorHidden: true,
    })
  })

  test('falls back to defaults when internals are missing or malformed', () => {
    const defaults = { mouseEncoding: 'DEFAULT', cursorHidden: false }
    expect(readTerminalModes(null)).toEqual(defaults)
    expect(readTerminalModes({})).toEqual(defaults)
    expect(readTerminalModes({ _core: {} })).toEqual(defaults)
    expect(readTerminalModes(fakeTerminal(42, 'yes'))).toEqual(defaults)
  })
})

describe('buildModeRestoreSequence', () => {
  test('re-applies SGR mouse encoding (Claude Code fullscreen)', () => {
    expect(buildModeRestoreSequence({ mouseEncoding: 'SGR', cursorHidden: false })).toBe(
      '\x1b[?1006h'
    )
  })

  test('re-applies SGR-pixels encoding', () => {
    expect(buildModeRestoreSequence({ mouseEncoding: 'SGR_PIXELS', cursorHidden: false })).toBe(
      '\x1b[?1016h'
    )
  })

  test('re-hides the cursor', () => {
    expect(buildModeRestoreSequence({ mouseEncoding: 'DEFAULT', cursorHidden: true })).toBe(
      '\x1b[?25l'
    )
  })

  test('combines both', () => {
    expect(buildModeRestoreSequence({ mouseEncoding: 'SGR', cursorHidden: true })).toBe(
      '\x1b[?1006h\x1b[?25l'
    )
  })

  test('emits nothing for default modes', () => {
    expect(buildModeRestoreSequence({ mouseEncoding: 'DEFAULT', cursorHidden: false })).toBe('')
  })
})
