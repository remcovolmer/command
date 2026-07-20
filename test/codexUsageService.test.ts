import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Per-test stubs the mocked fs/promises functions delegate to.
let accessStub: (p: string) => Promise<void> = async () => {}
let readdirStub: (...args: unknown[]) => Promise<string[]> = async () => ['rollout-a.jsonl']
let statStub: (p: string) => Promise<{ mtimeMs: number; size: number }> = async () => ({
  mtimeMs: 1,
  size: 100,
})
let readFileStub: (p: string) => Promise<string> = async () => ''

const accessSpy = vi.fn((p: string) => accessStub(p))
const readFileSpy = vi.fn((p: string) => readFileStub(p))

// Fake FileHandle for the tail-read path. Default throws so tests that keep
// sizes under the tail threshold catch an accidental tail read.
interface FakeHandle {
  read: (buf: Buffer, offset: number, length: number, position: number) => Promise<{ bytesRead: number }>
  close: () => Promise<void>
}
let openStub: () => Promise<FakeHandle> = async () => {
  throw new Error('open should not be called for small rollout files')
}
const openSpy = vi.fn(() => openStub())

/** A FileHandle whose read() fills the buffer with `tailContent`. */
function fakeHandle(tailContent: string): FakeHandle {
  return {
    read: async (buf: Buffer) => ({ bytesRead: buf.write(tailContent, 0, 'utf-8') }),
    close: async () => {},
  }
}

vi.mock('fs/promises', () => ({
  access: (p: string) => accessSpy(p),
  readdir: (...args: unknown[]) => readdirStub(...args),
  stat: (p: string) => statStub(p),
  readFile: (p: string) => readFileSpy(p),
  open: () => openSpy(),
}))

import {
  CodexUsageService,
  mapRateLimits,
  parseRateLimitsFromContent,
  windowLabelFromMinutes,
} from '../electron/main/services/CodexUsageService'

type WindowStub = Parameters<CodexUsageService['setWindow']>[0]

function makeWindow() {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as WindowStub
  return { win, send }
}

const FUTURE = 9_999_999_999 // epoch seconds, far future
const PAST = 1 // epoch seconds, 1970

function win(used_percent: number, window_minutes: number, resets_at?: number) {
  return { used_percent, window_minutes, resets_at }
}

function rl(primary: unknown, secondary: unknown, extra: Record<string, unknown> = {}) {
  return {
    limit_id: 'codex',
    primary,
    secondary,
    credits: { has_credits: false, unlimited: false, balance: '0' },
    plan_type: 'plus',
    ...extra,
  }
}

function rolloutLine(rateLimits: unknown): string {
  return JSON.stringify({
    timestamp: '2026-07-20T08:20:36.585Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: { model_context_window: 258400 }, rate_limits: rateLimits },
  })
}

beforeEach(() => {
  accessSpy.mockClear()
  readFileSpy.mockClear()
  accessStub = async () => {} // auth present
  readdirStub = async () => ['2026/07/20/rollout-a.jsonl']
  statStub = async () => ({ mtimeMs: 1, size: 100 })
  readFileStub = async () => rolloutLine(rl(win(37, 300, FUTURE), win(62, 10080, FUTURE)))
  openStub = async () => {
    throw new Error('open should not be called for small rollout files')
  }
})

describe('windowLabelFromMinutes', () => {
  test('derives labels from the window size', () => {
    expect(windowLabelFromMinutes(300)).toBe('5h')
    expect(windowLabelFromMinutes(10080)).toBe('wk')
    expect(windowLabelFromMinutes(1440)).toBe('1d')
    expect(windowLabelFromMinutes(120)).toBe('2h')
    expect(windowLabelFromMinutes(30)).toBe('30m')
  })
})

describe('parseRateLimitsFromContent', () => {
  test('returns the rate_limits block from a token_count line', () => {
    const content = rolloutLine(rl(win(37, 300, FUTURE), null))
    const raw = parseRateLimitsFromContent(content) as Record<string, unknown>
    expect(raw?.plan_type).toBe('plus')
  })

  test('returns the LAST token_count rate_limits when several are present', () => {
    const content = [
      rolloutLine(rl(win(10, 300, FUTURE), null)),
      '{"type":"event_msg","payload":{"type":"agent_message"}}',
      rolloutLine(rl(win(55, 300, FUTURE), null)),
    ].join('\n')
    const raw = parseRateLimitsFromContent(content) as Record<string, unknown>
    expect((raw?.primary as Record<string, unknown>).used_percent).toBe(55)
  })

  test('skips malformed lines and still finds a valid snapshot', () => {
    const content = ['{ this is not json rate_limits', rolloutLine(rl(win(42, 300, FUTURE), null))].join('\n')
    expect(parseRateLimitsFromContent(content)).not.toBeNull()
  })

  test('returns null when no token_count carries rate_limits', () => {
    expect(parseRateLimitsFromContent('{"type":"event_msg","payload":{"type":"agent_message"}}')).toBeNull()
    expect(parseRateLimitsFromContent('')).toBeNull()
  })
})

describe('mapRateLimits', () => {
  test('maps a 5h + weekly snapshot with derived labels and credits', () => {
    const data = mapRateLimits(rl(win(37, 300, FUTURE), win(62, 10080, FUTURE)), 2000)
    expect(data).toEqual({
      provider: 'codex',
      status: 'ok',
      fiveHour: { utilization: 37, resetsAt: new Date(FUTURE * 1000).toISOString(), label: '5h' },
      sevenDay: { utilization: 62, resetsAt: new Date(FUTURE * 1000).toISOString(), label: 'wk' },
      planType: 'plus',
      credits: { hasCredits: false, balance: '0' },
    })
  })

  test('maps a weekly-only snapshot to sevenDay, leaving fiveHour undefined', () => {
    const data = mapRateLimits(rl(win(1, 10080, FUTURE), null), 2000)
    expect(data?.status).toBe('ok')
    expect(data?.fiveHour).toBeUndefined()
    expect(data?.sevenDay?.utilization).toBe(1)
    expect(data?.sevenDay?.label).toBe('wk')
  })

  test('marks a rolled-over rendered window unavailable (5h and weekly-only)', () => {
    expect(mapRateLimits(rl(win(37, 300, PAST), win(62, 10080, FUTURE)), 2000)).toEqual({
      provider: 'codex',
      status: 'unavailable',
    })
    expect(mapRateLimits(rl(win(1, 10080, PAST), null), 2000)).toEqual({
      provider: 'codex',
      status: 'unavailable',
    })
  })

  test('does not treat an absent reset time as stale (no NaN comparison)', () => {
    const data = mapRateLimits(rl(win(1, 10080, undefined), null), 2000)
    expect(data?.status).toBe('ok')
    expect(data?.sevenDay?.utilization).toBe(1)
  })

  test('passes used_percent through on the 0–100 scale', () => {
    expect(mapRateLimits(rl(win(0, 300, FUTURE), null), 2000)?.fiveHour?.utilization).toBe(0)
    expect(mapRateLimits(rl(win(100, 300, FUTURE), null), 2000)?.fiveHour?.utilization).toBe(100)
  })

  test('stringifies a numeric credits balance', () => {
    const data = mapRateLimits(rl(win(5, 300, FUTURE), null, { credits: { has_credits: true, balance: 250 } }), 2000)
    expect(data?.credits).toEqual({ hasCredits: true, balance: '250' })
  })

  test('returns null when no usable window is present', () => {
    expect(mapRateLimits(rl(null, null), 2000)).toBeNull()
    expect(mapRateLimits('nope', 2000)).toBeNull()
    expect(mapRateLimits(null, 2000)).toBeNull()
  })

  test('tolerates an out-of-range resets_at without throwing (RangeError guard)', () => {
    // A microsecond-scale epoch overflows Date once multiplied by 1000.
    const data = mapRateLimits(rl(win(5, 300, 1.78e15), null), 2000)
    expect(data?.status).toBe('ok')
    expect(data?.fiveHour?.utilization).toBe(5)
    expect(data?.fiveHour?.resetsAt).toBe('') // bad epoch dropped to "unknown"
  })
})

describe('CodexUsageService.pollOnce', () => {
  let service: CodexUsageService
  let send: ReturnType<typeof vi.fn>

  beforeEach(() => {
    service = new CodexUsageService()
    const stub = makeWindow()
    service.setWindow(stub.win)
    send = stub.send
  })

  afterEach(() => {
    service.destroy()
  })

  test('emits an ok codex payload on a successful poll and never reads auth.json', async () => {
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'usage:update',
      expect.objectContaining({ provider: 'codex', status: 'ok', planType: 'plus' })
    )
    // Security: auth.json is presence-checked but never read.
    expect(accessSpy).toHaveBeenCalled()
    const readPaths = readFileSpy.mock.calls.map((c) => String(c[0]))
    expect(readPaths.some((p) => p.includes('auth.json'))).toBe(false)
  })

  test('no ~/.codex/auth.json and no prior emit → pushes nothing', async () => {
    accessStub = async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    await service.pollOnce()
    expect(send).not.toHaveBeenCalled()
  })

  test('does not re-emit unchanged data', async () => {
    await service.pollOnce()
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('no rollout carrying rate_limits → unavailable', async () => {
    readFileStub = async () => '{"type":"event_msg","payload":{"type":"agent_message"}}'
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith('usage:update', { provider: 'codex', status: 'unavailable' })
  })

  test('missing sessions dir → unavailable, no throw', async () => {
    readdirStub = async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith('usage:update', { provider: 'codex', status: 'unavailable' })
  })

  test('falls back to the next-newest rollout when the newest has no rate_limits', async () => {
    readdirStub = async () => ['2026/07/20/rollout-new.jsonl', '2026/07/19/rollout-old.jsonl']
    statStub = async (p: string) => ({ mtimeMs: p.includes('rollout-new') ? 200 : 100, size: 100 })
    readFileStub = async (p: string) =>
      p.includes('rollout-new')
        ? '{"type":"event_msg","payload":{"type":"agent_message"}}'
        : rolloutLine(rl(win(44, 300, FUTURE), null))
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith(
      'usage:update',
      expect.objectContaining({ provider: 'codex', status: 'ok', fiveHour: expect.objectContaining({ utilization: 44 }) })
    )
  })

  test('transient readdir error keeps last-good after a prior emit (no re-emit)', async () => {
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
    // A recoverable fs error (not ENOENT) must not flash the placeholder.
    readdirStub = async () => {
      throw Object.assign(new Error('EMFILE'), { code: 'EMFILE' })
    }
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('reads only the tail of a large rollout and parses its snapshot', async () => {
    statStub = async () => ({ mtimeMs: 1, size: 300_000 }) // > TAIL_BYTES → tail-read path
    openStub = async () => fakeHandle(rolloutLine(rl(win(50, 300, FUTURE), null)))
    readFileStub = async () => {
      throw new Error('must not full-read when the tail carries a snapshot')
    }
    await service.pollOnce()
    expect(openSpy).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'usage:update',
      expect.objectContaining({ provider: 'codex', status: 'ok', fiveHour: expect.objectContaining({ utilization: 50 }) })
    )
  })

  test('falls back to a full read when the tail carries no snapshot', async () => {
    statStub = async () => ({ mtimeMs: 1, size: 300_000 })
    openStub = async () => fakeHandle('{"partial malformed line with no rate_limits')
    readFileStub = async () => rolloutLine(rl(win(70, 300, FUTURE), null))
    await service.pollOnce()
    expect(openSpy).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'usage:update',
      expect.objectContaining({ provider: 'codex', status: 'ok', fiveHour: expect.objectContaining({ utilization: 70 }) })
    )
  })
})

describe('CodexUsageService timer lifecycle', () => {
  let service: CodexUsageService
  let send: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    service = new CodexUsageService()
    const stub = makeWindow()
    service.setWindow(stub.win)
    send = stub.send
  })

  afterEach(() => {
    service.destroy()
    vi.useRealTimers()
  })

  test('setEnabled(true) starts a jittered initial poll then a 60s interval', async () => {
    service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(send).toHaveBeenCalledTimes(1)
    // Unchanged data → interval poll does not re-emit, but it does run.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('destroy() clears all timers', async () => {
    service.setEnabled(true)
    service.destroy()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(send).not.toHaveBeenCalled()
  })
})
