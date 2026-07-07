import { describe, test, expect, vi } from 'vitest'
import { parseOsc52, createOsc52ClipboardHandler } from '../src/utils/osc52Clipboard'

// OSC 52 payloads xterm hands the handler look like "<Pc>;<Pd>". Build the
// base64 the way Claude Code does: UTF-8 bytes, base64-encoded.
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('parseOsc52', () => {
  test('decodes a base64 write payload to text', () => {
    expect(parseOsc52(`c;${b64('hello world')}`)).toEqual({
      kind: 'write',
      text: 'hello world',
    })
  })

  test('round-trips non-ASCII text as UTF-8 (no mojibake)', () => {
    // The exact failure mode of Claude Code issue #42417 on Windows: naive
    // latin1 decoding would corrupt these. Dutch diacritics + emoji.
    const original = 'café — één ✅ 日本語'
    expect(parseOsc52(`c;${b64(original)}`)).toEqual({ kind: 'write', text: original })
  })

  test('classifies a read request (Pd === "?") without decoding', () => {
    expect(parseOsc52('c;?')).toEqual({ kind: 'read' })
  })

  test('ignores an empty payload (clipboard-clear) rather than wiping', () => {
    expect(parseOsc52('c;')).toEqual({ kind: 'ignore', reason: 'empty payload' })
  })

  test('ignores a payload with no separator', () => {
    expect(parseOsc52('garbage')).toEqual({ kind: 'ignore', reason: 'no separator' })
  })

  test('ignores invalid base64', () => {
    // atob throws on this; parser must swallow and ignore.
    expect(parseOsc52('c;@@@not-base64@@@')).toEqual({ kind: 'ignore', reason: 'invalid base64' })
  })

  test('ignores an oversized payload before decoding it', () => {
    // Defensive bound (mirrors osc8LinkRouter): reject an absurd base64 payload
    // before the synchronous atob decode. xterm already caps at 10MB; this is
    // the tighter guard. 4 MB of base64 exceeds the 3 MB limit.
    const huge = 'A'.repeat(4_000_000)
    expect(parseOsc52(`c;${huge}`)).toEqual({
      kind: 'ignore',
      reason: 'payload exceeds length limit',
    })
  })

  test('accepts an empty clipboard-selection spec (Pc)', () => {
    expect(parseOsc52(`;${b64('data')}`)).toEqual({ kind: 'write', text: 'data' })
  })
})

describe('createOsc52ClipboardHandler', () => {
  test('writes decoded text to the clipboard', () => {
    const writeText = vi.fn()
    const handler = createOsc52ClipboardHandler({ writeText })

    handler.handle(`c;${b64('copied text')}`)

    expect(writeText).toHaveBeenCalledExactlyOnceWith('copied text')
  })

  test('never writes on a read request', () => {
    const writeText = vi.fn()
    const handler = createOsc52ClipboardHandler({ writeText })

    handler.handle('c;?')

    expect(writeText).not.toHaveBeenCalled()
  })

  test('dedupes identical consecutive writes (streaming re-emit spam)', () => {
    const writeText = vi.fn()
    const handler = createOsc52ClipboardHandler({ writeText })

    // Claude Code re-emits the same OSC 52 on every render while a selection is
    // held during streaming — issue #41954. Only the first should hit the IPC.
    const payload = `c;${b64('held selection')}`
    handler.handle(payload)
    handler.handle(payload)
    handler.handle(payload)

    expect(writeText).toHaveBeenCalledExactlyOnceWith('held selection')
  })

  test('writes again when the selection changes', () => {
    const writeText = vi.fn()
    const handler = createOsc52ClipboardHandler({ writeText })

    handler.handle(`c;${b64('first')}`)
    handler.handle(`c;${b64('second')}`)

    expect(writeText).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenNthCalledWith(1, 'first')
    expect(writeText).toHaveBeenNthCalledWith(2, 'second')
  })
})
