import { describe, test, expect } from 'vitest'
import { buildBaseHref, injectBaseHref, IFRAME_SANDBOX } from '../src/components/Editor/HtmlPreview'

describe('IFRAME_SANDBOX', () => {
  // Locks the security posture. Any change to the sandbox attribute requires
  // an explicit update here. See HtmlPreview.tsx comment block for why each
  // token is on/off.
  test('omits allow-same-origin so the iframe cannot reach window.parent.electronAPI', () => {
    expect(IFRAME_SANDBOX).not.toContain('allow-same-origin')
  })

  test('omits allow-top-navigation so previewed scripts cannot redirect the editor', () => {
    expect(IFRAME_SANDBOX).not.toContain('allow-top-navigation')
  })

  test('omits allow-popups-to-escape-sandbox so popups remain sandboxed', () => {
    expect(IFRAME_SANDBOX).not.toContain('allow-popups-to-escape-sandbox')
  })

  test('matches the agreed-upon token set exactly', () => {
    expect(IFRAME_SANDBOX).toBe('allow-scripts allow-forms allow-modals allow-popups')
  })
})

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

  test('escapes double-quote in baseHref so a quote-bearing path cannot break out of the href attribute', () => {
    const evil = 'file:///tmp/"><script>steal()</script>/'
    const out = injectBaseHref('<html></html>', evil)
    expect(out).not.toContain('<script>steal()</script>')
    expect(out).toContain('&quot;')
  })

  test('escapes ampersand in baseHref', () => {
    const out = injectBaseHref('<html></html>', 'file:///tmp/a&b/')
    expect(out).toContain('file:///tmp/a&amp;b/')
  })
})
