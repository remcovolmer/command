import { describe, test, expect } from 'vitest'
import { isAllowedMainWindowNavigation } from '../electron/main/utils/mainWindowNavigation'

const INDEX = 'file:///C:/Program%20Files/Command/resources/app.asar/dist/index.html'

describe('isAllowedMainWindowNavigation', () => {
  test('blocks a dropped file replacing the UI', () => {
    expect(isAllowedMainWindowNavigation('file:///C:/Users/x/notes.txt', INDEX, undefined)).toBe(
      false
    )
  })

  test('blocks external and custom-scheme navigations', () => {
    expect(isAllowedMainWindowNavigation('https://example.com/', INDEX, undefined)).toBe(false)
    expect(isAllowedMainWindowNavigation('javascript:alert(1)', INDEX, undefined)).toBe(false)
    expect(isAllowedMainWindowNavigation('not a url', INDEX, undefined)).toBe(false)
  })

  test('allows staying on the current document (hash ignored)', () => {
    expect(isAllowedMainWindowNavigation(`${INDEX}#settings`, INDEX, undefined)).toBe(true)
  })

  test('allows the dev-server origin in development', () => {
    const dev = 'http://localhost:5173/'
    expect(isAllowedMainWindowNavigation('http://localhost:5173/', dev, dev)).toBe(true)
    expect(isAllowedMainWindowNavigation('http://localhost:5173/src/x', dev, dev)).toBe(true)
    expect(isAllowedMainWindowNavigation('file:///C:/dropped.png', dev, dev)).toBe(false)
    expect(isAllowedMainWindowNavigation('http://localhost:3000/', dev, dev)).toBe(false)
  })
})
