import { describe, test, expect } from 'vitest'
import {
  MAX_TERMINAL_WRITE_BYTES,
  formatOversizeMessage,
  validateTerminalWritePayload,
} from '../electron/main/utils/terminalWriteLimits'

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

describe('validateTerminalWritePayload', () => {
  test('accepts empty string', () => {
    const result = validateTerminalWritePayload('')
    expect(result).toEqual({ ok: true, data: '' })
  })

  test('accepts typical keystroke input', () => {
    const result = validateTerminalWritePayload('npm test\n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe('npm test\n')
  })

  test('accepts payload at the inclusive 1MB boundary', () => {
    const data = 'x'.repeat(MAX_TERMINAL_WRITE_BYTES)
    const result = validateTerminalWritePayload(data)
    expect(result.ok).toBe(true)
  })

  test('rejects payload one byte over the limit as too-large', () => {
    const data = 'x'.repeat(MAX_TERMINAL_WRITE_BYTES + 1)
    const result = validateTerminalWritePayload(data)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('too-large')
      if (result.reason === 'too-large') {
        expect(result.size).toBe(MAX_TERMINAL_WRITE_BYTES + 1)
        expect(result.limit).toBe(MAX_TERMINAL_WRITE_BYTES)
      }
    }
  })

  test('rejects non-string payloads as invalid-type', () => {
    for (const input of [null, undefined, 42, true, {}, [], Buffer.from('x')]) {
      const result = validateTerminalWritePayload(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('invalid-type')
    }
  })

  test('respects custom limit override', () => {
    const result = validateTerminalWritePayload('hello', 3)
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === 'too-large') {
      expect(result.limit).toBe(3)
      expect(result.size).toBe(5)
    }
  })
})

describe('formatOversizeMessage', () => {
  test('reports size and limit in KB', () => {
    const msg = formatOversizeMessage(2_097_152, 1_000_000)
    expect(msg.title).toBe('Paste too large')
    expect(msg.body).toMatch(/2048 KB/)
    expect(msg.body).toMatch(/977 KB/)
  })

  test('produces a body users can act on (references limits and suggests alternative)', () => {
    const msg = formatOversizeMessage(1_500_000, MAX_TERMINAL_WRITE_BYTES)
    expect(msg.body).toMatch(/KB/)
    expect(msg.body.toLowerCase()).toMatch(/file|too large|exceeds/)
  })
})
