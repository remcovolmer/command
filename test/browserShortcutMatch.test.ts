import { describe, test, expect } from 'vitest'
import { matchBrowserShortcut, type KeyInputLike } from '../electron/main/utils/browserShortcut'

function input(overrides: Partial<KeyInputLike>): KeyInputLike {
  return {
    type: 'keyDown',
    key: 'a',
    control: false,
    meta: false,
    shift: false,
    alt: false,
    ...overrides,
  }
}

describe('matchBrowserShortcut', () => {
  test('Ctrl+= and Ctrl++ zoom in', () => {
    expect(matchBrowserShortcut(input({ control: true, key: '=' }))).toBe('browser.zoomIn')
    expect(matchBrowserShortcut(input({ control: true, key: '+' }))).toBe('browser.zoomIn')
  })

  test('Ctrl+- zooms out', () => {
    expect(matchBrowserShortcut(input({ control: true, key: '-' }))).toBe('browser.zoomOut')
  })

  test('Ctrl+0 resets zoom', () => {
    expect(matchBrowserShortcut(input({ control: true, key: '0' }))).toBe('browser.zoomReset')
  })

  test('Ctrl+F opens find', () => {
    expect(matchBrowserShortcut(input({ control: true, key: 'f' }))).toBe('browser.find')
    // shift-uppercased key still matches via lowercasing... but find requires no shift
    expect(matchBrowserShortcut(input({ control: true, key: 'F', shift: true }))).toBeNull()
  })

  test('Ctrl+Shift+R hard reloads', () => {
    expect(matchBrowserShortcut(input({ control: true, shift: true, key: 'R' }))).toBe(
      'browser.hardReload'
    )
  })

  test('Ctrl+Shift+= ("Ctrl and +") zooms in', () => {
    expect(matchBrowserShortcut(input({ control: true, shift: true, key: '+' }))).toBe(
      'browser.zoomIn'
    )
  })

  test('Ctrl+Shift+- ("Ctrl and _") zooms out', () => {
    expect(matchBrowserShortcut(input({ control: true, shift: true, key: '_' }))).toBe(
      'browser.zoomOut'
    )
  })

  test('Cmd (meta) works as the primary modifier too', () => {
    expect(matchBrowserShortcut(input({ meta: true, key: '=' }))).toBe('browser.zoomIn')
  })

  test('no primary modifier never matches', () => {
    expect(matchBrowserShortcut(input({ key: 'f' }))).toBeNull()
    expect(matchBrowserShortcut(input({ key: '=' }))).toBeNull()
  })

  test('Alt combos are ignored', () => {
    expect(matchBrowserShortcut(input({ control: true, alt: true, key: '=' }))).toBeNull()
  })

  test('keyUp is ignored', () => {
    expect(matchBrowserShortcut(input({ type: 'keyUp', control: true, key: '=' }))).toBeNull()
  })

  test('unrelated keys fall through', () => {
    expect(matchBrowserShortcut(input({ control: true, key: 'a' }))).toBeNull()
  })
})
