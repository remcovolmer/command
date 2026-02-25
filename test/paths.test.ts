import { describe, test, expect, vi, afterEach } from 'vitest'
import { normalizePath } from '../electron/main/utils/paths'

describe('normalizePath', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('converts backslashes to forward slashes', () => {
    const result = normalizePath('C:\\Users\\foo\\bar')
    // On Windows, also lowercased
    if (process.platform === 'win32') {
      expect(result).toBe('c:/users/foo/bar')
    } else {
      expect(result).toBe('C:/Users/foo/bar')
    }
  })

  test('removes trailing slash', () => {
    const result = normalizePath('C:/Users/foo/')
    expect(result).not.toMatch(/\/$/)
  })

  test('preserves root path slash', () => {
    expect(normalizePath('/')).toBe('/')
  })

  test('preserves Windows drive root (C:/)', () => {
    if (process.platform === 'win32') {
      expect(normalizePath('C:/')).toBe('c:/')
      expect(normalizePath('C:\\')).toBe('c:/')
    } else {
      expect(normalizePath('C:/')).toBe('C:/')
    }
  })

  test('handles empty and minimal paths', () => {
    expect(normalizePath('')).toBe('')
    expect(normalizePath('.')).toBe('.')
  })

  describe('Windows case normalization', () => {
    test('produces identical output regardless of input casing', () => {
      if (process.platform === 'win32') {
        expect(normalizePath('C:\\Users\\Foo')).toBe('c:/users/foo')
        expect(normalizePath('c:\\Users\\Foo')).toBe('c:/users/foo')
        expect(normalizePath('C:/foo/bar')).toBe(normalizePath('c:/foo/bar'))
        expect(normalizePath('D:\\Project')).toBe(normalizePath('d:\\project'))
      }
    })
  })

  test('handles paths with no backslashes', () => {
    const result = normalizePath('/usr/local/bin')
    expect(result).toBe('/usr/local/bin')
  })

  test('handles Windows UNC-style paths', () => {
    const result = normalizePath('\\\\server\\share\\path')
    expect(result).toContain('//server/share/path')
  })
})
