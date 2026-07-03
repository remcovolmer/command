import { describe, test, expect } from 'vitest'
import {
  hardenWebviewPreferences,
  BROWSER_PARTITION,
  type WebviewPreferencesLike,
  type WebviewAttachParamsLike,
} from '../electron/main/utils/webviewSecurity'

describe('hardenWebviewPreferences', () => {
  test('strips an injected preload', () => {
    const prefs: WebviewPreferencesLike = { preload: '/evil/preload.js' }
    hardenWebviewPreferences(prefs, {})
    expect(prefs.preload).toBeUndefined()
  })

  test('forces Node off and isolation on regardless of requested values', () => {
    const prefs: WebviewPreferencesLike = {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    }
    hardenWebviewPreferences(prefs, {})
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
  })

  test('pins the isolated persistent partition on both prefs and params', () => {
    const prefs: WebviewPreferencesLike = { partition: 'persist:something-else' }
    const params: WebviewAttachParamsLike = { partition: 'persist:something-else' }
    hardenWebviewPreferences(prefs, params)
    expect(prefs.partition).toBe(BROWSER_PARTITION)
    expect(params.partition).toBe(BROWSER_PARTITION)
  })

  test('partition is persistent and app-isolated', () => {
    expect(BROWSER_PARTITION.startsWith('persist:')).toBe(true)
    expect(BROWSER_PARTITION).not.toBe('persist:')
  })
})
