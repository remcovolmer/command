import { describe, test, expect } from 'vitest'

/**
 * Extracted validation logic matching the IPC handler in electron/main/index.ts (line ~484):
 *
 *   const VALID_CLAUDE_MODES = ['chat', 'auto', 'full-auto']
 *   claudeMode: VALID_CLAUDE_MODES.includes(s.claudeMode as string) ? s.claudeMode : 'chat'
 */
const VALID_CLAUDE_MODES = ['chat', 'auto', 'full-auto']

function validateClaudeMode(input: unknown): string {
  return VALID_CLAUDE_MODES.includes(input as string) ? (input as string) : 'chat'
}

describe('claudeMode IPC validation', () => {
  describe('valid modes pass through', () => {
    test.each(['chat', 'auto', 'full-auto'])('"%s" passes through unchanged', (mode) => {
      expect(validateClaudeMode(mode)).toBe(mode)
    })
  })

  describe('invalid strings fall back to chat', () => {
    test.each([
      'invalid',
      'fullauto',
      '',
      'CHAT',
      'Auto',
      'Full-Auto',
      'full_auto',
    ])('"%s" falls back to "chat"', (mode) => {
      expect(validateClaudeMode(mode)).toBe('chat')
    })
  })

  describe('non-string types fall back to chat', () => {
    test('null falls back to chat', () => {
      expect(validateClaudeMode(null)).toBe('chat')
    })

    test('undefined falls back to chat', () => {
      expect(validateClaudeMode(undefined)).toBe('chat')
    })

    test('number falls back to chat', () => {
      expect(validateClaudeMode(42)).toBe('chat')
    })

    test('boolean falls back to chat', () => {
      expect(validateClaudeMode(true)).toBe('chat')
    })

    test('object falls back to chat', () => {
      expect(validateClaudeMode({ mode: 'auto' })).toBe('chat')
    })

    test('array falls back to chat', () => {
      expect(validateClaudeMode(['auto'])).toBe('chat')
    })
  })
})
