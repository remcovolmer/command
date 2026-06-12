import { describe, test, expect } from 'vitest'
import { DEFAULT_HOTKEY_CONFIG } from '../src/utils/hotkeys'

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
