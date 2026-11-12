import { describe, test, expect } from 'vitest'
import { buildPasteAction, RAW_CTRL_V } from '../src/utils/terminalPaste'

describe('buildPasteAction', () => {
  test('no clipboard text (e.g. an image) forwards a raw Ctrl+V byte', () => {
    expect(buildPasteAction('', true)).toEqual({ kind: 'raw', data: RAW_CTRL_V })
    expect(buildPasteAction(null, false)).toEqual({ kind: 'raw', data: '\x16' })
    expect(buildPasteAction(undefined, true)).toEqual({ kind: 'raw', data: '\x16' })
  })

  test('wraps in bracketed-paste markers when DECSET 2004 is on', () => {
    expect(buildPasteAction('hello', true)).toEqual({
      kind: 'input',
      data: '\x1b[200~hello\x1b[201~',
    })
  })

  test('bracketed: normalises CRLF/CR to LF (survives main-process CR stripping)', () => {
    expect(buildPasteAction('a\r\nb\rc\nd', true).data).toBe('\x1b[200~a\nb\nc\nd\x1b[201~')
  })

  test('unbracketed: mirrors xterm and sends newlines as CR', () => {
    expect(buildPasteAction('a\r\nb\nc', false)).toEqual({ kind: 'input', data: 'a\rb\rc' })
  })

  test('strips embedded paste markers so content cannot end the bracket early', () => {
    expect(buildPasteAction('x\x1b[201~rm -rf\x1b[200~y', true).data).toBe(
      '\x1b[200~xrm -rfy\x1b[201~'
    )
  })
})
