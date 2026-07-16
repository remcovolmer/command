import { describe, test, expect, vi } from 'vitest'
import {
  buildCommentMessage,
  buildEditMessage,
  buildDrawMessage,
  resolveActiveAgentTerminalId,
  sendAnnotationToChat,
  fileUrlToLocalPath,
  applyDirectEdit,
  minimalEdit,
  sanitizeField,
} from '../src/utils/annotationMessage'

describe('message builders', () => {
  test('buildCommentMessage includes url, selector, snippet and comment', () => {
    const msg = buildCommentMessage({
      url: 'http://localhost:3000/report',
      selector: 'button.primary',
      snippet: '<button class="primary">Score</button>',
      comment: 'maak groter',
    })
    expect(msg).toContain('http://localhost:3000/report')
    expect(msg).toContain('button.primary')
    expect(msg).toContain('<button class="primary">Score</button>')
    expect(msg).toContain('maak groter')
  })

  test('buildEditMessage includes before and after text', () => {
    const msg = buildEditMessage({
      url: 'file:///x.html',
      selector: 'h2',
      before: 'Reosultaten',
      after: 'Resultaten',
    })
    expect(msg).toContain('Reosultaten')
    expect(msg).toContain('Resultaten')
    expect(msg).toContain('inline edit')
  })

  test('buildDrawMessage references the url and the Alt+V paste', () => {
    const msg = buildDrawMessage({ url: 'http://localhost:5173/' })
    expect(msg).toContain('http://localhost:5173/')
    expect(msg).toContain('Alt+V')
  })

  test('strips control chars from page-derived fields (no CR/ESC reaches the PTY)', () => {
    const msg = buildCommentMessage({
      url: 'file:///x.html',
      selector: 'h2',
      snippet: 'a\rb',
      comment: 'stuur\r\nrm -rf /\x1b[2J',
    })
    expect(msg).not.toContain('\r') // the Enter byte that would auto-submit
    expect(msg).not.toContain('\x1b') // no terminal escape sequences
    expect(msg).toContain('ab') // \r removed, surrounding text kept
    expect(msg).toContain('stuur\nrm -rf /[2J') // \n survives, \r and ESC gone
  })
})

describe('sanitizeField', () => {
  test('removes CR and ESC but keeps newlines and tabs', () => {
    expect(sanitizeField('a\rb')).toBe('ab')
    expect(sanitizeField('x\x1b[31mred')).toBe('x[31mred')
    expect(sanitizeField('line1\nline2\tcol')).toBe('line1\nline2\tcol')
  })
})

describe('resolveActiveAgentTerminalId', () => {
  const claude = { id: 't1', type: 'claude' }
  const normal = { id: 't2', type: 'normal' }
  const codex = { id: 't3', type: 'codex' }

  test('returns the id when the active terminal is a Claude chat', () => {
    expect(
      resolveActiveAgentTerminalId({ activeTerminalId: 't1', terminals: { t1: claude } })
    ).toBe('t1')
  })

  test('returns the id when the active terminal is a codex chat', () => {
    expect(
      resolveActiveAgentTerminalId({ activeTerminalId: 't3', terminals: { t3: codex } })
    ).toBe('t3')
  })

  test('returns null when the active terminal is a plain shell', () => {
    expect(
      resolveActiveAgentTerminalId({ activeTerminalId: 't2', terminals: { t2: normal } })
    ).toBeNull()
  })

  test('returns null when there is no active terminal', () => {
    expect(resolveActiveAgentTerminalId({ activeTerminalId: null, terminals: {} })).toBeNull()
  })

  test('returns null when the active id is not in the terminal map', () => {
    expect(
      resolveActiveAgentTerminalId({ activeTerminalId: 'gone', terminals: { t1: claude } })
    ).toBeNull()
  })
})

describe('sendAnnotationToChat', () => {
  test('writes to the active Claude terminal and reports ok', () => {
    const write = vi.fn()
    const result = sendAnnotationToChat(
      'hello',
      { activeTerminalId: 't1', terminals: { t1: { id: 't1', type: 'claude' } } },
      write
    )
    expect(result).toEqual({ ok: true, terminalId: 't1' })
    expect(write).toHaveBeenCalledWith('t1', 'hello')
  })

  test('guards with no-active-chat and does not write when there is no Claude chat', () => {
    const write = vi.fn()
    const result = sendAnnotationToChat(
      'hello',
      { activeTerminalId: 't2', terminals: { t2: { id: 't2', type: 'normal' } } },
      write
    )
    expect(result).toEqual({ ok: false, reason: 'no-active-chat' })
    expect(write).not.toHaveBeenCalled()
  })
})

describe('fileUrlToLocalPath', () => {
  test('converts a Windows file URL to a drive path', () => {
    expect(fileUrlToLocalPath('file:///C:/Users/me/report.html')).toBe('C:/Users/me/report.html')
  })

  test('converts a POSIX file URL', () => {
    expect(fileUrlToLocalPath('file:///home/me/report.html')).toBe('/home/me/report.html')
  })

  test('decodes percent-encoding', () => {
    expect(fileUrlToLocalPath('file:///home/me/my%20report.html')).toBe('/home/me/my report.html')
  })

  test('returns null for non-file URLs', () => {
    expect(fileUrlToLocalPath('http://localhost:3000/report')).toBeNull()
    expect(fileUrlToLocalPath('https://example.com')).toBeNull()
  })
})

describe('applyDirectEdit', () => {
  test('replaces a single occurrence', () => {
    expect(applyDirectEdit('<h2>Reosultaten</h2>', 'Reosultaten', 'Resultaten')).toEqual({
      ok: true,
      content: '<h2>Resultaten</h2>',
    })
  })

  test('refuses when the text is absent', () => {
    expect(applyDirectEdit('<h2>Hello</h2>', 'Missing', 'X')).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  test('refuses an empty before', () => {
    expect(applyDirectEdit('abc', '', 'X')).toEqual({ ok: false, reason: 'not-found' })
  })

  test('refuses when the text occurs more than once', () => {
    expect(applyDirectEdit('<p>hi</p><p>hi</p>', 'hi', 'yo')).toEqual({
      ok: false,
      reason: 'ambiguous',
    })
  })

  test('replaces just the changed word across an inline tag', () => {
    expect(applyDirectEdit('<h1>Mijn <b>Titel</b></h1>', 'Mijn Titel', 'Mijn Kop')).toEqual({
      ok: true,
      content: '<h1>Mijn <b>Kop</b></h1>',
    })
  })

  test('replaces despite collapsed whitespace in the source', () => {
    expect(applyDirectEdit('<h1>Mijn   Titel</h1>', 'Mijn Titel', 'Mijn Kop')).toEqual({
      ok: true,
      content: '<h1>Mijn   Kop</h1>',
    })
  })

  test('handles a deletion', () => {
    expect(applyDirectEdit('<p>Hello World</p>', 'Hello World', 'Hello')).toEqual({
      ok: true,
      content: '<p>Hello</p>',
    })
  })

  test('disambiguates a repeated word via surrounding context (keyed branch)', () => {
    // The whole selection is broken by an inline tag (so the verbatim match
    // fails) and the changed word ("42") recurs elsewhere (so the bare-span
    // match is ambiguous) — only the context-keyed branch can place the edit.
    const before = 'This is a long lead-in sentence with 42 trailing words that pad the tail out further'
    const after = before.replace('42', '99')
    const content =
      '<p><b>This is</b> a long lead-in sentence with 42 trailing words that pad the tail out further</p><span>42</span>'
    const result = applyDirectEdit(content, before, after)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain('with 99 trailing')
      expect(result.content).toContain('<span>42</span>') // the decoy stays untouched
    }
  })
})

describe('minimalEdit (code-point scan)', () => {
  test('keeps an edited emoji whole instead of splitting its surrogate pair', () => {
    // 😀 (U+1F600) and 😁 (U+1F601) share a high surrogate; a UTF-16 code-unit
    // scan would leave a lone low surrogate as the changed span.
    const { coreBefore, coreAfter } = minimalEdit('Score: 😀 great', 'Score: 😁 great')
    expect(coreBefore).toBe('😀')
    expect(coreAfter).toBe('😁')
  })
})
