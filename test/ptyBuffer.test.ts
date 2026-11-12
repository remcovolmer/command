import { describe, test, expect } from 'vitest'
import { findSafeCut, modeRestorePrefix, trimPreservingModes } from '../electron/main/utils/ptyBuffer'

const fill = (n: number, ch = 'x') => ch.repeat(n)

describe('trimPreservingModes', () => {
  test('buffer within cap is returned unchanged', () => {
    const buf = '\x1b[?1049hhello'
    expect(trimPreservingModes(buf, 100)).toBe(buf)
  })

  test('without escape sequences behaves like the old line-boundary trim', () => {
    const buf = 'line1\nline2\nline3\n'
    // excess = 18 - 10 = 8 → first \n at/after 8 is index 11 → keep "line3\n"
    expect(trimPreservingModes(buf, 10)).toBe('line3\n')
  })

  test('falls back to the raw excess when there is no line break', () => {
    expect(trimPreservingModes(fill(20), 10)).toBe(fill(10))
  })

  test('re-emits alt screen, mouse, focus and bracketed-paste modes set in the dropped prefix', () => {
    const prefix = '\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[?25l'
    const buf = prefix + fill(100) + '\n' + 'tail'
    const out = trimPreservingModes(buf, 10)
    expect(out).toBe(
      '\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?2004h\x1b[?25l' + 'tail'
    )
  })

  test('multi-parameter DECSET form is split into individual modes', () => {
    const buf = '\x1b[?1000;1006;1004h' + fill(50) + '\ntail'
    expect(trimPreservingModes(buf, 5)).toBe('\x1b[?1000h\x1b[?1006h\x1b[?1004h' + 'tail')
  })

  test('only the final state of a mode is kept (set then reset → reset)', () => {
    const buf = '\x1b[?1049h' + fill(20) + '\x1b[?1049l' + fill(20) + '\ntail'
    expect(trimPreservingModes(buf, 5)).toBe('\x1b[?1049l' + 'tail')
  })

  test('replay order follows last change so interacting mouse modes resolve correctly', () => {
    // 1000h, 1003h, then 1000l: replay must end with 1000l (xterm: reset → no mouse).
    const buf = '\x1b[?1000h\x1b[?1003h\x1b[?1000l' + fill(30) + '\ntail'
    expect(trimPreservingModes(buf, 5)).toBe('\x1b[?1003h\x1b[?1000l' + 'tail')
  })

  test('untracked and non-private CSI h/l sequences are not replayed', () => {
    const buf = '\x1b[4h\x1b[?9999h\x1b[31m' + fill(30) + '\ntail'
    expect(trimPreservingModes(buf, 5)).toBe('tail')
  })

  test('modes set in the retained tail are not duplicated into the prefix', () => {
    const buf = fill(30) + '\n' + '\x1b[?2004htail'
    expect(trimPreservingModes(buf, 15)).toBe('\x1b[?2004htail')
  })

  test('never cuts inside a CSI sequence that straddles the cut', () => {
    // No line break → target = excess, which lands inside "\x1b[?1049h".
    const buf = fill(8) + '\x1b[?1049h' + 'abcdef'
    // length 22, max 12 → excess 10 → index 10 is inside the sequence (8..15)
    const out = trimPreservingModes(buf, 12)
    expect(out).toBe('\x1b[?1049h' + 'abcdef')
  })

  test('never cuts inside an OSC string, even at a newline inside it', () => {
    const osc = '\x1b]0;title\nwith newline\x07'
    const buf = fill(4) + osc + 'rest' // length 31
    // max 25 → excess 6 → the first \n at/after 6 is INSIDE the OSC (index 13)
    const out = trimPreservingModes(buf, 25)
    expect(out).toBe('rest')
  })

  test('OSC terminated by ST (ESC \\) is skipped as one unit', () => {
    const buf = fill(4) + '\x1b]8;;http://x\x1b\\' + 'rest'
    expect(trimPreservingModes(buf, 10)).toBe('rest')
  })

  test('never cuts between the halves of a surrogate pair', () => {
    const emoji = '\u{1F600}' // two UTF-16 code units
    const buf = 'a' + emoji + 'bcdef' // length 8
    // max 6 → excess 2 → index 2 is the low surrogate; cut must move past it
    const out = trimPreservingModes(buf, 6)
    expect(out).toBe('bcdef')
    expect(out.charCodeAt(0)).toBe('b'.charCodeAt(0))
  })

  test('repeated trims keep carrying the mode prefix forward', () => {
    let buf = '\x1b[?1049h\x1b[?1002h'
    for (let i = 0; i < 20; i++) {
      buf = trimPreservingModes(buf + fill(40) + '\n', 50)
    }
    expect(buf.startsWith('\x1b[?1049h\x1b[?1002h')).toBe(true)
    expect(buf.length).toBeLessThanOrEqual(50 + '\x1b[?1049h\x1b[?1002h'.length)
  })
})

describe('findSafeCut', () => {
  test('returns the target when already in ground state', () => {
    const modes = new Map<number, boolean>()
    expect(findSafeCut('abcdef', 3, modes)).toBe(3)
    expect(modes.size).toBe(0)
  })

  test('ESC inside an OSC aborts it and starts a new escape', () => {
    const modes = new Map<number, boolean>()
    // OSC aborted by "\x1b[?25l" (CSI), which must still be recorded.
    const data = '\x1b]0;t\x1b[?25lzz'
    expect(findSafeCut(data, 1, modes)).toBe(data.indexOf('zz'))
    expect(modes.get(25)).toBe(false)
  })

  test('an unterminated sequence at the end cuts the whole buffer', () => {
    const modes = new Map<number, boolean>()
    expect(findSafeCut('ab\x1b[?10', 3, modes)).toBe(7)
  })
})

describe('modeRestorePrefix', () => {
  test('serializes modes in map order', () => {
    const modes = new Map<number, boolean>([
      [1049, true],
      [25, false],
    ])
    expect(modeRestorePrefix(modes)).toBe('\x1b[?1049h\x1b[?25l')
  })
})
