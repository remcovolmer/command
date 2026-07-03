import { describe, test, expect } from 'vitest'
import {
  sanitizeClipboardImage,
  sanitizeClipboardText,
} from '../electron/main/utils/clipboardLimits'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA=='

describe('sanitizeClipboardImage', () => {
  test('accepts an in-bounds png data URL', () => {
    expect(sanitizeClipboardImage(PNG)).toBe(PNG)
  })

  test('accepts jpeg and webp', () => {
    expect(sanitizeClipboardImage('data:image/jpeg;base64,abc')).toBe('data:image/jpeg;base64,abc')
    expect(sanitizeClipboardImage('data:image/webp;base64,abc')).toBe('data:image/webp;base64,abc')
  })

  test('rejects non-strings', () => {
    expect(sanitizeClipboardImage(null)).toBeNull()
    expect(sanitizeClipboardImage(123)).toBeNull()
    expect(sanitizeClipboardImage(undefined)).toBeNull()
  })

  test('rejects non-image data URLs and plain strings', () => {
    expect(sanitizeClipboardImage('data:text/plain;base64,abc')).toBeNull()
    expect(sanitizeClipboardImage('https://example.com/x.png')).toBeNull()
    expect(sanitizeClipboardImage('hello')).toBeNull()
  })

  test('rejects payloads over the limit', () => {
    const oversize = 'data:image/png;base64,' + 'A'.repeat(50)
    expect(sanitizeClipboardImage(oversize, 40)).toBeNull()
  })
})

describe('sanitizeClipboardText', () => {
  test('passes an in-bounds string through', () => {
    expect(sanitizeClipboardText('hello')).toBe('hello')
  })

  test('rejects non-strings', () => {
    expect(sanitizeClipboardText(42)).toBeNull()
  })
})
