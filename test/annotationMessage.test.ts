import { describe, test, expect, vi } from 'vitest'
import {
  buildCommentMessage,
  buildEditMessage,
  buildDrawMessage,
  resolveActiveClaudeTerminalId,
  sendAnnotationToChat,
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
})

describe('resolveActiveClaudeTerminalId', () => {
  const claude = { id: 't1', type: 'claude' }
  const normal = { id: 't2', type: 'normal' }

  test('returns the id when the active terminal is a Claude chat', () => {
    expect(
      resolveActiveClaudeTerminalId({ activeTerminalId: 't1', terminals: { t1: claude } })
    ).toBe('t1')
  })

  test('returns null when the active terminal is a plain shell', () => {
    expect(
      resolveActiveClaudeTerminalId({ activeTerminalId: 't2', terminals: { t2: normal } })
    ).toBeNull()
  })

  test('returns null when there is no active terminal', () => {
    expect(resolveActiveClaudeTerminalId({ activeTerminalId: null, terminals: {} })).toBeNull()
  })

  test('returns null when the active id is not in the terminal map', () => {
    expect(
      resolveActiveClaudeTerminalId({ activeTerminalId: 'gone', terminals: { t1: claude } })
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
