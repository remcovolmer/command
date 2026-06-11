import { describe, test, expect } from 'vitest'
import { DEFAULT_HOTKEY_CONFIG, backfillHotkeyConfig } from '../src/utils/hotkeys'
import type { HotkeyConfig } from '../src/types/hotkeys'

describe('DEFAULT_HOTKEY_CONFIG', () => {
  test('default bindings are unique outside the dialog category', () => {
    // Dialog hotkeys (Escape/Enter) intentionally reuse keys in scoped contexts.
    const seen = new Map<string, string>()
    for (const [action, binding] of Object.entries(DEFAULT_HOTKEY_CONFIG)) {
      if (binding.category === 'dialog') continue
      const signature = [...binding.modifiers].sort().join('+') + '+' + binding.key.toLowerCase()
      const existing = seen.get(signature)
      expect(existing, `${action} collides with ${existing} on ${signature}`).toBeUndefined()
      seen.set(signature, action)
    }
  })

  test('ui.toggleUsageIndicator is bound to Ctrl+Shift+U', () => {
    const binding = DEFAULT_HOTKEY_CONFIG['ui.toggleUsageIndicator']
    expect(binding.key).toBe('u')
    expect([...binding.modifiers].sort()).toEqual(['ctrl', 'shift'])
    expect(binding.enabled).toBe(true)
  })
})

describe('backfillHotkeyConfig', () => {
  test('adds actions missing from a persisted config', () => {
    const persisted = { ...DEFAULT_HOTKEY_CONFIG } as Partial<HotkeyConfig>
    delete persisted['ui.toggleUsageIndicator']

    const result = backfillHotkeyConfig(persisted)

    expect(result['ui.toggleUsageIndicator']).toEqual(
      DEFAULT_HOTKEY_CONFIG['ui.toggleUsageIndicator']
    )
  })

  test('preserves user-customized bindings for existing actions', () => {
    const persisted: Partial<HotkeyConfig> = {
      ...DEFAULT_HOTKEY_CONFIG,
      'ui.toggleTheme': {
        ...DEFAULT_HOTKEY_CONFIG['ui.toggleTheme'],
        key: 'd',
        enabled: false,
      },
    }

    const result = backfillHotkeyConfig(persisted)

    expect(result['ui.toggleTheme'].key).toBe('d')
    expect(result['ui.toggleTheme'].enabled).toBe(false)
  })
})
