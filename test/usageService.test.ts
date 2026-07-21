import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Per-test stub that fs/promises.readFile delegates to.
let readFileStub: () => Promise<string> = async () => {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

vi.mock('fs/promises', () => ({
  readFile: (..._args: unknown[]) => readFileStub(),
}))

vi.mock('../electron/main/services/Logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

// Import after mock so the service picks up the stub.
import {
  UsageService,
  parseCredentials,
  mapUsageResponse,
  classifyHttpFailure,
} from '../electron/main/services/UsageService'

type WindowStub = Parameters<UsageService['setWindow']>[0]

function makeWindow() {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as WindowStub
  return { win, send }
}

const fetchMock = vi.fn<(...args: unknown[]) => Promise<unknown>>()
vi.stubGlobal('fetch', fetchMock)

function validCreds(expiresInMs = 3_600_000): string {
  return JSON.stringify({
    claudeAiOauth: { accessToken: 'test-token', expiresAt: Date.now() + expiresInMs },
  })
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errResponse(status: number) {
  return { ok: false, status, json: async () => ({}) }
}

function fullBody() {
  return {
    five_hour: { utilization: 45.0, resets_at: '2026-06-11T17:50:00+00:00' },
    seven_day: { utilization: 6.0, resets_at: '2026-06-16T11:00:00+00:00' },
    seven_day_sonnet: { utilization: 0.0, resets_at: '2026-06-16T10:59:59+00:00' },
    extra_usage: { is_enabled: true, used_credits: 7784.0, currency: 'EUR' },
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  readFileStub = async () => validCreds()
})

describe('parseCredentials', () => {
  test('extracts token and expiry from valid file content', () => {
    const creds = parseCredentials(validCreds())
    expect(creds?.accessToken).toBe('test-token')
    expect(typeof creds?.expiresAt).toBe('number')
  })

  test('returns null on malformed JSON', () => {
    expect(parseCredentials('{not json')).toBeNull()
  })

  test('returns null when claudeAiOauth or token is missing', () => {
    expect(parseCredentials(JSON.stringify({}))).toBeNull()
    expect(parseCredentials(JSON.stringify({ claudeAiOauth: {} }))).toBeNull()
    expect(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: '' } }))).toBeNull()
  })

  test('tolerates missing expiresAt', () => {
    const creds = parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 't' } }))
    expect(creds?.accessToken).toBe('t')
    expect(creds?.expiresAt).toBeUndefined()
  })
})

describe('mapUsageResponse', () => {
  test('maps a full response including optional blocks', () => {
    const data = mapUsageResponse(fullBody())
    expect(data).toEqual({
      provider: 'claude',
      status: 'ok',
      fiveHour: { utilization: 45.0, resetsAt: '2026-06-11T17:50:00+00:00' },
      sevenDay: { utilization: 6.0, resetsAt: '2026-06-16T11:00:00+00:00' },
      sevenDaySonnet: { utilization: 0.0, resetsAt: '2026-06-16T10:59:59+00:00' },
      extraUsage: { usedCredits: 7784.0, currency: 'EUR' },
    })
  })

  test('maps when optional blocks are null or absent', () => {
    const body = { ...fullBody(), seven_day_sonnet: null, extra_usage: undefined }
    const data = mapUsageResponse(body)
    expect(data?.status).toBe('ok')
    expect(data?.sevenDaySonnet).toBeUndefined()
    expect(data?.extraUsage).toBeUndefined()
  })

  test('maps when five_hour is null but seven_day is present (idle window)', () => {
    const body = { ...fullBody(), five_hour: null }
    const data = mapUsageResponse(body)
    expect(data?.status).toBe('ok')
    expect(data?.fiveHour).toBeUndefined()
    expect(data?.sevenDay?.utilization).toBe(6.0)
  })

  test('returns null when both primary windows are missing (shape drift)', () => {
    expect(mapUsageResponse({})).toBeNull()
    expect(mapUsageResponse({ five_hour: null, seven_day: null })).toBeNull()
    expect(mapUsageResponse('nope')).toBeNull()
    expect(mapUsageResponse(null)).toBeNull()
  })

  test('rejects windows with wrong field types', () => {
    expect(mapUsageResponse({ five_hour: { utilization: '45', resets_at: 'x' } })).toBeNull()
  })
})

describe('classifyHttpFailure', () => {
  test('401/403 with locally-expired token is transient (refresh pending)', () => {
    expect(classifyHttpFailure(401, true)).toBe('transient')
    expect(classifyHttpFailure(403, true)).toBe('transient')
  })

  test('401/403 with valid token is unavailable', () => {
    expect(classifyHttpFailure(401, false)).toBe('unavailable')
    expect(classifyHttpFailure(403, false)).toBe('unavailable')
  })

  test('429 and 5xx are transient', () => {
    expect(classifyHttpFailure(429, false)).toBe('transient')
    expect(classifyHttpFailure(500, false)).toBe('transient')
    expect(classifyHttpFailure(503, false)).toBe('transient')
  })

  test('other 4xx are unavailable', () => {
    expect(classifyHttpFailure(400, false)).toBe('unavailable')
    expect(classifyHttpFailure(404, false)).toBe('unavailable')
  })
})

describe('UsageService.pollOnce', () => {
  let service: UsageService
  let send: ReturnType<typeof vi.fn>

  beforeEach(() => {
    service = new UsageService()
    const stub = makeWindow()
    service.setWindow(stub.win)
    send = stub.send
  })

  afterEach(() => {
    service.destroy()
  })

  test('emits ok payload on successful poll', async () => {
    fetchMock.mockResolvedValue(okResponse(fullBody()))
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'usage:update',
      expect.objectContaining({
        status: 'ok',
        fiveHour: { utilization: 45.0, resetsAt: '2026-06-11T17:50:00+00:00' },
      })
    )
    // Token must never appear in the payload.
    expect(JSON.stringify(send.mock.calls)).not.toContain('test-token')
  })

  test('does not re-emit unchanged data', async () => {
    fetchMock.mockResolvedValue(okResponse(fullBody()))
    await service.pollOnce()
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('emits again when utilization changes', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(fullBody()))
    const changed = fullBody()
    changed.five_hour.utilization = 50.0
    fetchMock.mockResolvedValueOnce(okResponse(changed))
    await service.pollOnce()
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('missing credentials file emits unavailable once', async () => {
    readFileStub = async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    await service.pollOnce()
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('usage:update', {
      provider: 'claude',
      status: 'unavailable',
    })
  })

  test('malformed credentials emit unavailable without throwing', async () => {
    readFileStub = async () => '{broken'
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith('usage:update', {
      provider: 'claude',
      status: 'unavailable',
    })
  })

  test('401 with expired token is transient, recovers on next 200', async () => {
    readFileStub = async () => validCreds(-1000) // already expired
    fetchMock.mockResolvedValueOnce(errResponse(401))
    await service.pollOnce()
    expect(send).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(okResponse(fullBody()))
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('usage:update', expect.objectContaining({ status: 'ok' }))
  })

  test('401 with valid token emits unavailable', async () => {
    fetchMock.mockResolvedValue(errResponse(401))
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith('usage:update', {
      provider: 'claude',
      status: 'unavailable',
    })
  })

  test('transient failures keep last-good data (no emit)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(fullBody()))
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await service.pollOnce()
    fetchMock.mockResolvedValueOnce(errResponse(500))
    await service.pollOnce()
    fetchMock.mockResolvedValueOnce(errResponse(429))
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('200 with unusable body emits unavailable', async () => {
    fetchMock.mockResolvedValue(okResponse({ something: 'else' }))
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith('usage:update', {
      provider: 'claude',
      status: 'unavailable',
    })
  })

  test('200 with malformed JSON (SyntaxError) emits unavailable', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await service.pollOnce()
    expect(send).toHaveBeenCalledWith('usage:update', {
      provider: 'claude',
      status: 'unavailable',
    })
  })

  test('connection drop during body read is transient, keeps last-good', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(fullBody()))
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)

    // undici surfaces a mid-body network failure as a non-SyntaxError
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new TypeError('terminated')
      },
    })
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('repeated setEnabled(true) forces a fresh emit for a reloaded renderer', async () => {
    fetchMock.mockResolvedValue(okResponse(fullBody()))
    service.setEnabled(true)
    await service.pollOnce()
    expect(send).toHaveBeenCalledTimes(1)

    // Same data again would normally be deduped; a repeated enable signals a
    // reloaded renderer with empty state and must re-emit.
    service.setEnabled(true)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    service.setEnabled(false)
  })
})

describe('UsageService timer lifecycle', () => {
  let service: UsageService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new UsageService()
    const stub = makeWindow()
    service.setWindow(stub.win)
    fetchMock.mockResolvedValue(okResponse(fullBody()))
  })

  afterEach(() => {
    service.destroy()
    vi.useRealTimers()
  })

  test('setEnabled(true) starts jittered initial poll and 60s interval', async () => {
    service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('setEnabled(true) is idempotent (no doubled interval)', async () => {
    service.setEnabled(true)
    service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(5_000)
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('setEnabled(false) stops polling entirely', async () => {
    service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(5_000)
    fetchMock.mockClear()
    service.setEnabled(false)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('pause() drops to reduced cadence instead of stopping', async () => {
    service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(5_000)
    fetchMock.mockClear()
    service.pause()
    // No immediate poll on blur; nothing within the focused interval.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).not.toHaveBeenCalled()
    // Reduced cadence still fires.
    await vi.advanceTimersByTimeAsync(240_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('resume() polls immediately and restores 60s cadence', async () => {
    service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(5_000)
    service.pause()
    fetchMock.mockClear()
    service.resume()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('resume() while disabled does not start polling', async () => {
    service.resume()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('destroy() clears all timers', async () => {
    service.setEnabled(true)
    service.destroy()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
