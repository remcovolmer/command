import { describe, test, expect } from 'vitest'
import { DEFAULT_HOTKEY_CONFIG, mergeMissingHotkeyDefaults } from '../src/utils/hotkeys'
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

describe('mergeMissingHotkeyDefaults', () => {
  test('prunes actions that no longer exist in DEFAULT_HOTKEY_CONFIG', () => {
    // A config persisted by a pre-0.21.0 version still carries the since-removed
    // split-view hotkeys. Left in place they reach HotkeyRow, which dereferences
    // DEFAULT_HOTKEY_CONFIG[action].key and throws on `undefined` — white-screening
    // the whole Settings dialog.
    const stale = {
      ...DEFAULT_HOTKEY_CONFIG,
      'terminal.split': {
        key: 'd',
        modifiers: ['ctrl'],
        description: 'Split terminal',
        category: 'terminal',
        enabled: true,
      },
      'terminal.unsplit': {
        key: 'd',
        modifiers: ['ctrl', 'shift'],
        description: 'Unsplit terminal',
        category: 'terminal',
        enabled: true,
      },
    } as unknown as HotkeyConfig

    const merged = mergeMissingHotkeyDefaults(stale)

    expect('terminal.split' in merged).toBe(false)
    expect('terminal.unsplit' in merged).toBe(false)
    // Every surviving action must resolve to a real default (the invariant
    // HotkeyRow relies on).
    for (const action of Object.keys(merged)) {
      expect(action in DEFAULT_HOTKEY_CONFIG).toBe(true)
    }
  })

  test('backfills actions added after the config was persisted', () => {
    const { 'ui.openSettings': _omitted, ...withoutOne } = DEFAULT_HOTKEY_CONFIG
    const merged = mergeMissingHotkeyDefaults(withoutOne as HotkeyConfig)
    expect(merged['ui.openSettings']).toEqual(DEFAULT_HOTKEY_CONFIG['ui.openSettings'])
  })

  test('preserves user customizations for actions that still exist', () => {
    const customized = {
      ...DEFAULT_HOTKEY_CONFIG,
      'ui.openSettings': {
        ...DEFAULT_HOTKEY_CONFIG['ui.openSettings'],
        key: 'p',
        modifiers: ['ctrl', 'alt'],
      },
    } as HotkeyConfig
    const merged = mergeMissingHotkeyDefaults(customized)
    expect(merged['ui.openSettings'].key).toBe('p')
    expect([...merged['ui.openSettings'].modifiers].sort()).toEqual(['alt', 'ctrl'])
  })

  test('returns the same reference when nothing changes', () => {
    const merged = mergeMissingHotkeyDefaults(DEFAULT_HOTKEY_CONFIG)
    expect(merged).toBe(DEFAULT_HOTKEY_CONFIG)
  })
})
