import { describe, test, expect } from 'vitest'
import { applyDomEdit } from '../src/utils/htmlEdit'

// parse5 (like the browser) inserts an implied <head>, so <body> is the SECOND
// element child of <html> — index paths from the guest start with 1.
describe('applyDomEdit', () => {
  test('splices only the target inner range, preserving the rest byte-for-byte', () => {
    const src = '<html><body>\n  <h1 class="t">Mijn <b>Titel</b></h1>\n  <p>x</p>\n</body></html>'
    const result = applyDomEdit(src, [1, 0], 'h1', 'Mijn Kop')
    expect(result).toEqual({
      ok: true,
      content: '<html><body>\n  <h1 class="t">Mijn Kop</h1>\n  <p>x</p>\n</body></html>',
    })
  })

  test('edits a nested element, leaving siblings and formatting intact', () => {
    const src = '<html><body><section><p>one</p><p>two</p></section></body></html>'
    // html -> body(1) -> section(0) -> second p(1)
    const result = applyDomEdit(src, [1, 0, 1], 'p', 'TWO')
    expect(result).toEqual({
      ok: true,
      content: '<html><body><section><p>one</p><p>TWO</p></section></body></html>',
    })
  })

  test('preserves attributes and surrounding whitespace of the edited element', () => {
    const src = '<html><body>\n<div id="a" data-x="1">  old  </div>\n</body></html>'
    const result = applyDomEdit(src, [1, 0], 'div', 'new')
    expect(result).toEqual({
      ok: true,
      content: '<html><body>\n<div id="a" data-x="1">new</div>\n</body></html>',
    })
  })

  test('returns not-found when the index path runs off the tree', () => {
    const src = '<html><body><p>x</p></body></html>'
    expect(applyDomEdit(src, [1, 5], 'p', 'y')).toEqual({ ok: false, reason: 'not-found' })
  })

  test('returns not-found when the tag guard disagrees (structural drift)', () => {
    const src = '<html><body><h1>x</h1></body></html>'
    expect(applyDomEdit(src, [1, 0], 'p', 'y')).toEqual({ ok: false, reason: 'not-found' })
  })
})
