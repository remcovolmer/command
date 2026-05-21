import { describe, test, expect } from 'vitest'
import { buildBaseHref, injectBaseHref } from '../src/components/Editor/HtmlPreview'

describe('buildBaseHref', () => {
  test('converts a Windows directory to a file:/// URL', () => {
    expect(buildBaseHref('C:\\Users\\foo\\site')).toBe('file:///C:/Users/foo/site/')
  })

  test('appends a trailing slash when missing', () => {
    expect(buildBaseHref('/var/www/site')).toBe('file:///var/www/site/')
  })

  test('preserves a trailing slash when present', () => {
    expect(buildBaseHref('/var/www/site/')).toBe('file:///var/www/site/')
  })

  test('handles POSIX absolute paths with a single file:// prefix', () => {
    expect(buildBaseHref('/home/user/site')).toBe('file:///home/user/site/')
  })
})

describe('injectBaseHref', () => {
  const HREF = 'file:///tmp/site/'

  test('injects CSP meta and <base> immediately after <head>', () => {
    const html = '<html><head><title>x</title></head><body></body></html>'
    const out = injectBaseHref(html, HREF)
    const cspPos = out.indexOf('Content-Security-Policy')
    const basePos = out.indexOf('<base href="file:///tmp/site/">')
    const titlePos = out.indexOf('<title>')
    expect(cspPos).toBeGreaterThan(-1)
    expect(basePos).toBeGreaterThan(-1)
    expect(cspPos).toBeLessThan(basePos)
    expect(basePos).toBeLessThan(titlePos)
  })

  test('CSP meta precedes any inline script in the document', () => {
    const html = '<html><head><script>console.log("x")</script></head></html>'
    const out = injectBaseHref(html, HREF)
    const cspPos = out.indexOf('Content-Security-Policy')
    const scriptPos = out.indexOf('<script>')
    expect(cspPos).toBeLessThan(scriptPos)
  })

  test('handles <head> with attributes', () => {
    const html = '<html><head data-foo="bar"><title>x</title></head></html>'
    const out = injectBaseHref(html, HREF)
    expect(out).toContain('<head data-foo="bar"><meta http-equiv="Content-Security-Policy"')
  })

  test('prepends to documents with no <head>', () => {
    const html = '<h1>No head</h1>'
    const out = injectBaseHref(html, HREF)
    expect(out.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(out).toContain('<base href="file:///tmp/site/"><h1>No head</h1>')
  })

  test('does not crash on empty content', () => {
    const out = injectBaseHref('', HREF)
    expect(out).toContain('Content-Security-Policy')
    expect(out).toContain('<base href="file:///tmp/site/">')
  })

  test('matches case-insensitively', () => {
    const html = '<HTML><HEAD></HEAD></HTML>'
    const out = injectBaseHref(html, HREF)
    expect(out).toContain('<HEAD><meta http-equiv="Content-Security-Policy"')
  })

  test('document with an existing <base> still has ours injected earlier (theirs wins by declaration order)', () => {
    const html = '<html><head><base href="https://existing.example/"><title>x</title></head></html>'
    const out = injectBaseHref(html, HREF)
    const ourPos = out.indexOf('file:///tmp/site/')
    const theirPos = out.indexOf('https://existing.example/')
    expect(ourPos).toBeGreaterThan(-1)
    expect(theirPos).toBeGreaterThan(-1)
    expect(ourPos).toBeLessThan(theirPos)
  })
})
