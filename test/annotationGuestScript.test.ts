import { describe, test, expect } from 'vitest'
import {
  readSelectionScript,
  startEditScript,
  readEditScript,
  enableDrawScript,
  clearAnnotationsScript,
  isSelectionResult,
  isEditStartResult,
  isEditResult,
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
    readSelectionScript: readSelectionScript(),
    startEditScript: startEditScript(),
    readEditScript: readEditScript(),
    enableDrawScript: enableDrawScript(),
    clearAnnotationsScript: clearAnnotationsScript(),
  }

  for (const [name, code] of Object.entries(scripts)) {
    test(`${name} is syntactically valid and self-invoking`, () => {
      expect(isSyntacticallyValid(code)).toBe(true)
      expect(code.trimStart().startsWith('(function()')).toBe(true)
    })
  }

  test('readSelectionScript reads selection, outerHTML, selector and url', () => {
    const s = readSelectionScript()
    expect(s).toContain('getSelection')
    expect(s).toContain('outerHTML')
    expect(s).toContain('location.href')
    expect(s).toContain('__cc_annotate_highlight')
  })

  test('startEditScript sets contentEditable and stashes before-state', () => {
    const s = startEditScript()
    expect(s).toContain('contentEditable')
    expect(s).toContain('__ccEditEl')
    expect(s).toContain('__ccEditBefore')
  })

  test('readEditScript reverts editability and returns before/after', () => {
    const s = readEditScript()
    expect(s).toContain('__ccEditEl')
    expect(s).toContain('inherit')
    expect(s).toContain('after')
  })

  test('enableDrawScript creates a pointer-driven canvas overlay', () => {
    const s = enableDrawScript()
    expect(s).toContain('__cc_annotate_canvas')
    expect(s).toContain('pointerdown')
    expect(s).toContain("getContext('2d')")
  })

  test('clearAnnotationsScript removes highlight, canvas and edit state', () => {
    const s = clearAnnotationsScript()
    expect(s).toContain('__cc_annotate_highlight')
    expect(s).toContain('__cc_annotate_canvas')
    expect(s).toContain('__ccEditEl')
  })
})

describe('result guards', () => {
  test('isSelectionResult', () => {
    expect(isSelectionResult({ text: 'a', outerHTML: '<b>', selector: 'b', url: 'x' })).toBe(true)
    expect(isSelectionResult(null)).toBe(false)
    expect(isSelectionResult({ text: 'a' })).toBe(false)
    expect(isSelectionResult({ text: 1, outerHTML: '', selector: '', url: '' })).toBe(false)
  })

  test('isEditStartResult', () => {
    expect(isEditStartResult({ selector: 'b', before: 'x' })).toBe(true)
    expect(isEditStartResult({ selector: 'b' })).toBe(false)
    expect(isEditStartResult(null)).toBe(false)
  })

  test('isEditResult', () => {
    expect(isEditResult({ before: 'a', after: 'b', selector: 'c', url: 'd' })).toBe(true)
    expect(isEditResult({ before: 'a', after: 'b' })).toBe(false)
    expect(isEditResult(undefined)).toBe(false)
  })
})
