import { describe, test, expect } from 'vitest'
import {
  installEditContextMenuScript,
  enableCommentInspectScript,
  enableMarkupScript,
  resetMarkupScript,
  clearAnnotationsScript,
  isEditResult,
  parseEditSaveMessage,
  parseMarkupMessage,
  parseCommentMessage,
  EDIT_SAVE_SENTINEL,
  MARKUP_ADD_SENTINEL,
  MARKUP_CANCEL_SENTINEL,
  COMMENT_SENTINEL,
} from '../src/utils/annotationGuestScript'

// new Function(body) compiles but does not execute, so it validates the
// injected JS is syntactically well-formed without needing a live DOM.
function isSyntacticallyValid(code: string): boolean {
  try {
    new Function(code)
    return true
  } catch {
    return false
  }
}

describe('guest script builders produce valid JS', () => {
  const scripts = {
    installEditContextMenuScript: installEditContextMenuScript(),
    enableCommentInspectScript: enableCommentInspectScript(),
    enableMarkupScript: enableMarkupScript(),
    resetMarkupScript: resetMarkupScript(),
    clearAnnotationsScript: clearAnnotationsScript(),
  }

  for (const [name, code] of Object.entries(scripts)) {
    test(`${name} is syntactically valid and self-invoking`, () => {
      expect(isSyntacticallyValid(code)).toBe(true)
      expect(code.trimStart().startsWith('(function()')).toBe(true)
    })
  }

  test('enableCommentInspectScript highlights on hover and opens a comment box on click', () => {
    const s = enableCommentInspectScript()
    expect(s).toContain('elementFromPoint')
    expect(s).toContain('__cc_annotate_highlight')
    expect(s).toContain('ccShowComment')
    expect(s).toContain('outerHTML')
    expect(s).toContain(COMMENT_SENTINEL)
  })

  test('installEditContextMenuScript wires right-click edit, key-blocking and a save signal', () => {
    const s = installEditContextMenuScript()
    expect(s).toContain('contextmenu')
    expect(s).toContain('contentEditable')
    expect(s).toContain('Opslaan')
    expect(s).toContain('keydown')
    expect(s).toContain('stopPropagation')
    expect(s).toContain('ccIndexPath')
    expect(s).toContain('innerHTML')
    expect(s).toContain('Comment')
    expect(s).toContain('ccShowComment')
    expect(s).toContain(EDIT_SAVE_SENTINEL)
    expect(s).toContain(COMMENT_SENTINEL)
  })

  test('enableMarkupScript builds a canvas + floating toolbar with tools and actions', () => {
    const s = enableMarkupScript()
    expect(s).toContain('__cc_annotate_canvas')
    expect(s).toContain('__cc_annotate_markupbar')
    expect(s).toContain('pointerdown')
    expect(s).toContain("getContext('2d')")
    expect(s).toContain('Voeg toe aan chat')
    expect(s).toContain('Cancel')
    expect(s).toContain(MARKUP_ADD_SENTINEL)
    expect(s).toContain(MARKUP_CANCEL_SENTINEL)
  })

  test('clearAnnotationsScript removes highlight, canvas and tears down edit', () => {
    const s = clearAnnotationsScript()
    expect(s).toContain('__cc_annotate_highlight')
    expect(s).toContain('__cc_annotate_canvas')
    expect(s).toContain('__ccTeardownEdit')
  })
})

describe('result guards', () => {
  test('isEditResult', () => {
    expect(
      isEditResult({
        before: 'a',
        after: 'b',
        html: '<b>b</b>',
        selector: 'c',
        indexPath: [1, 0],
        tag: 'p',
        url: 'd',
      })
    ).toBe(true)
    expect(isEditResult({ before: 'a', after: 'b' })).toBe(false)
    expect(
      isEditResult({
        before: 'a',
        after: 'b',
        html: 'x',
        selector: 'c',
        indexPath: ['nope'],
        tag: 'p',
        url: 'd',
      })
    ).toBe(false)
    expect(isEditResult(undefined)).toBe(false)
  })
})

describe('parseEditSaveMessage', () => {
  const payload = {
    before: 'Reosultaten',
    after: 'Resultaten',
    html: 'Resultaten',
    selector: 'h2',
    indexPath: [1, 0],
    tag: 'h2',
    url: 'file:///x.html',
  }

  test('parses a sentinel-prefixed payload', () => {
    const msg = EDIT_SAVE_SENTINEL + JSON.stringify(payload)
    expect(parseEditSaveMessage(msg)).toEqual(payload)
  })

  test('ignores messages without the sentinel prefix', () => {
    expect(parseEditSaveMessage(JSON.stringify(payload))).toBeNull()
    expect(parseEditSaveMessage('some page log line')).toBeNull()
    expect(parseEditSaveMessage(42)).toBeNull()
  })

  test('ignores a sentinel with malformed JSON', () => {
    expect(parseEditSaveMessage(EDIT_SAVE_SENTINEL + '{not json')).toBeNull()
  })

  test('ignores a sentinel whose payload has the wrong shape', () => {
    expect(parseEditSaveMessage(EDIT_SAVE_SENTINEL + JSON.stringify({ before: 'a' }))).toBeNull()
  })
})

describe('parseMarkupMessage', () => {
  test('classifies add and cancel signals', () => {
    expect(parseMarkupMessage(MARKUP_ADD_SENTINEL)).toBe('add')
    expect(parseMarkupMessage(MARKUP_CANCEL_SENTINEL)).toBe('cancel')
  })

  test('ignores other messages', () => {
    expect(parseMarkupMessage('random page log')).toBeNull()
    expect(parseMarkupMessage(EDIT_SAVE_SENTINEL + '{}')).toBeNull()
    expect(parseMarkupMessage(42)).toBeNull()
  })
})

describe('parseCommentMessage', () => {
  const payload = { selector: 'h2', snippet: '<h2>x</h2>', comment: 'te klein', url: 'file:///x.html' }

  test('parses a sentinel-prefixed comment payload', () => {
    expect(parseCommentMessage(COMMENT_SENTINEL + JSON.stringify(payload))).toEqual(payload)
  })

  test('ignores non-comment, malformed, or wrong-shape messages', () => {
    expect(parseCommentMessage(JSON.stringify(payload))).toBeNull()
    expect(parseCommentMessage(COMMENT_SENTINEL + '{bad')).toBeNull()
    expect(parseCommentMessage(COMMENT_SENTINEL + JSON.stringify({ selector: 'h2' }))).toBeNull()
    expect(parseCommentMessage(42)).toBeNull()
  })
})
