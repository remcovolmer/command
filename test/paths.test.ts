import { describe, test, expect, vi, afterEach } from 'vitest'
import { normalizePath } from '../electron/main/utils/paths'

describe('normalizePath', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\foo\\bar')).toMatch(/c:\/users\/foo\/bar/i)
  })

  test('removes trailing slash', () => {
    const result = normalizePath('C:/Users/foo/')
    expect(result).not.toMatch(/\/$/)
  })

  test('preserves root path slash (single char path)', () => {
    // Single character path like "/" should not be stripped
    expect(normalizePath('/')).toBe('/')
  })

  test('handles empty-ish paths', () => {
    expect(normalizePath('')).toBe('')
    expect(normalizePath('.')).toBeTruthy()
  })

  describe('Windows case normalization', () => {
    test('lowercases drive letter on Windows', () => {
      // On Windows (current platform), paths should be lowercased
      if (process.platform === 'win32') {
        expect(normalizePath('C:\\Users\\Foo')).toBe('c:/users/foo')
        expect(normalizePath('c:\\Users\\Foo')).toBe('c:/users/foo')
      }
    })

    test('lowercases entire path on Windows for consistent matching', () => {
      if (process.platform === 'win32') {
        const path1 = normalizePath('C:\\Users\\RemcoVolmer\\Code')
        const path2 = normalizePath('c:\\Users\\RemcoVolmer\\Code')
        expect(path1).toBe(path2)
      }
    })

    test('mixed drive letter casing produces same result on Windows', () => {
      if (process.platform === 'win32') {
        expect(normalizePath('C:/foo/bar')).toBe(normalizePath('c:/foo/bar'))
        expect(normalizePath('D:\\Project')).toBe(normalizePath('d:\\project'))
      }
    })
  })

  test('handles paths with no backslashes', () => {
    const result = normalizePath('/usr/local/bin')
    expect(result).toBe(process.platform === 'win32' ? '/usr/local/bin' : '/usr/local/bin')
  })

  test('handles Windows UNC-style paths', () => {
    const result = normalizePath('\\\\server\\share\\path')
    expect(result).toContain('//server/share/path')
  })
})
