import { describe, test, expect } from 'vitest'
import { pathToFileUrl, normalizeAddressBarInput } from '../src/utils/browserUrls'

describe('pathToFileUrl', () => {
  test('Windows drive-letter path gets three slashes', () => {
    expect(pathToFileUrl('C:\\Users\\me\\report.html')).toBe('file:///C:/Users/me/report.html')
  })

  test('POSIX absolute path gets two slashes', () => {
    expect(pathToFileUrl('/home/me/report.html')).toBe('file:///home/me/report.html')
  })

  test('normalizes backslashes to forward slashes', () => {
    expect(pathToFileUrl('C:\\a\\b\\c.html')).toBe('file:///C:/a/b/c.html')
  })

  test('percent-encodes spaces but keeps the drive colon and slashes', () => {
    expect(pathToFileUrl('C:\\My Reports\\a.html')).toBe('file:///C:/My%20Reports/a.html')
  })

  test('escapes # so it is not read as a URL fragment', () => {
    expect(pathToFileUrl('C:\\reports\\draft#2.html')).toBe(
      'file:///C:/reports/draft%232.html'
    )
  })

  test('escapes ? so it is not read as a URL query', () => {
    expect(pathToFileUrl('C:\\reports\\a?b.html')).toBe('file:///C:/reports/a%3Fb.html')
  })

  test('escapes # combined with a space (e.g. "C# notes")', () => {
    expect(pathToFileUrl('C:\\C# notes\\report.html')).toBe(
      'file:///C:/C%23%20notes/report.html'
    )
  })
})

describe('normalizeAddressBarInput', () => {
  test('bare host gets an http:// prefix', () => {
    expect(normalizeAddressBarInput('localhost:5173')).toBe('http://localhost:5173')
  })

  test('http(s) URLs pass through unchanged', () => {
    expect(normalizeAddressBarInput('https://example.com')).toBe('https://example.com')
    expect(normalizeAddressBarInput('http://localhost:3000')).toBe('http://localhost:3000')
  })

  test('file:// URLs pass through unchanged', () => {
    expect(normalizeAddressBarInput('file:///C:/a/b.html')).toBe('file:///C:/a/b.html')
  })

  test('trims whitespace', () => {
    expect(normalizeAddressBarInput('  example.com  ')).toBe('http://example.com')
  })

  test('empty or whitespace-only input returns null', () => {
    expect(normalizeAddressBarInput('')).toBeNull()
    expect(normalizeAddressBarInput('   ')).toBeNull()
  })
})
