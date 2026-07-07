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

// A stand-in for the per-document random nonce the host mints and injects.
const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

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
    installEditContextMenuScript: installEditContextMenuScript(NONCE),
    enableCommentInspectScript: enableCommentInspectScript(NONCE),
    enableMarkupScript: enableMarkupScript(NONCE),
    resetMarkupScript: resetMarkupScript(),
    clearAnnotationsScript: clearAnnotationsScript(),
  }

  for (const [name, code] of Object.entries(scripts)) {
    test(`${name} is syntactically valid and self-invoking`, () => {
      expect(isSyntacticallyValid(code)).toBe(true)
      expect(code.trimStart().startsWith('(function()')).toBe(true)
    })
  }

  test('signal-emitting scripts embed the nonce as a function-scoped var, never on window', () => {
    for (const build of [
      installEditContextMenuScript,
      enableCommentInspectScript,
      enableMarkupScript,
    ]) {
      const s = build(NONCE)
      expect(s).toContain('var ccNonce=')
      expect(s).toContain(NONCE) // the nonce value is inlined into the payload
      // Must not be reachable by page scripts sharing the guest world.
      expect(s).not.toContain('window.ccNonce')
      expect(s).not.toContain('window.__ccNonce')
    }
  })

  test('enableCommentInspectScript highlights on hover and opens a comment box on click', () => {
    const s = enableCommentInspectScript(NONCE)
    expect(s).toContain('elementFromPoint')
    expect(s).toContain('__cc_annotate_highlight')
    expect(s).toContain('ccShowComment')
    expect(s).toContain('outerHTML')
    expect(s).toContain(COMMENT_SENTINEL)
  })

  test('installEditContextMenuScript wires right-click edit, key-blocking and a save signal', () => {
    const s = installEditContextMenuScript(NONCE)
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
    const s = enableMarkupScript(NONCE)
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

describe('parseEditSaveMessage (nonce-gated)', () => {
  const payload = {
    before: 'Reosultaten',
    after: 'Resultaten',
    html: 'Resultaten',
    selector: 'h2',
    indexPath: [1, 0],
    tag: 'h2',
    url: 'file:///x.html',
  }

  test('parses a sentinel-prefixed payload whose nonce matches (nonce stripped)', () => {
    const msg = EDIT_SAVE_SENTINEL + JSON.stringify({ ...payload, n: NONCE })
    expect(parseEditSaveMessage(msg, NONCE)).toEqual(payload)
  })

  test('rejects a forged payload: wrong nonce, missing nonce, or empty expected nonce', () => {
    expect(
      parseEditSaveMessage(EDIT_SAVE_SENTINEL + JSON.stringify({ ...payload, n: 'wrong' }), NONCE)
    ).toBeNull()
    expect(parseEditSaveMessage(EDIT_SAVE_SENTINEL + JSON.stringify(payload), NONCE)).toBeNull()
    expect(
      parseEditSaveMessage(EDIT_SAVE_SENTINEL + JSON.stringify({ ...payload, n: NONCE }), '')
    ).toBeNull()
  })

  test('ignores non-sentinel, malformed, and wrong-shape messages', () => {
    expect(parseEditSaveMessage(JSON.stringify({ ...payload, n: NONCE }), NONCE)).toBeNull()
    expect(parseEditSaveMessage(EDIT_SAVE_SENTINEL + '{not json', NONCE)).toBeNull()
    expect(
      parseEditSaveMessage(EDIT_SAVE_SENTINEL + JSON.stringify({ before: 'a', n: NONCE }), NONCE)
    ).toBeNull()
    expect(parseEditSaveMessage(42, NONCE)).toBeNull()
  })
})

describe('parseMarkupMessage (nonce-gated)', () => {
  test('classifies add and cancel only with the exact nonce suffix', () => {
    expect(parseMarkupMessage(MARKUP_ADD_SENTINEL + NONCE, NONCE)).toBe('add')
    expect(parseMarkupMessage(MARKUP_CANCEL_SENTINEL + NONCE, NONCE)).toBe('cancel')
  })

  test('rejects a bare sentinel, a wrong nonce, or an empty expected nonce', () => {
    expect(parseMarkupMessage(MARKUP_ADD_SENTINEL, NONCE)).toBeNull()
    expect(parseMarkupMessage(MARKUP_ADD_SENTINEL + 'wrong', NONCE)).toBeNull()
    expect(parseMarkupMessage(MARKUP_ADD_SENTINEL + NONCE, '')).toBeNull()
    expect(parseMarkupMessage('random page log', NONCE)).toBeNull()
    expect(parseMarkupMessage(42, NONCE)).toBeNull()
  })
})

describe('parseCommentMessage (nonce-gated)', () => {
  const payload = { selector: 'h2', snippet: '<h2>x</h2>', comment: 'te klein', url: 'file:///x.html' }

  test('parses a matching-nonce comment payload (nonce stripped)', () => {
    expect(
      parseCommentMessage(COMMENT_SENTINEL + JSON.stringify({ ...payload, n: NONCE }), NONCE)
    ).toEqual(payload)
  })

  test('rejects wrong/missing/empty nonce and non-comment, malformed, wrong-shape messages', () => {
    expect(
      parseCommentMessage(COMMENT_SENTINEL + JSON.stringify({ ...payload, n: 'x' }), NONCE)
    ).toBeNull()
    expect(parseCommentMessage(COMMENT_SENTINEL + JSON.stringify(payload), NONCE)).toBeNull()
    expect(
      parseCommentMessage(COMMENT_SENTINEL + JSON.stringify({ ...payload, n: NONCE }), '')
    ).toBeNull()
    expect(parseCommentMessage(JSON.stringify({ ...payload, n: NONCE }), NONCE)).toBeNull()
    expect(parseCommentMessage(COMMENT_SENTINEL + '{bad', NONCE)).toBeNull()
    expect(
      parseCommentMessage(COMMENT_SENTINEL + JSON.stringify({ selector: 'h2', n: NONCE }), NONCE)
    ).toBeNull()
    expect(parseCommentMessage(42, NONCE)).toBeNull()
  })
})
