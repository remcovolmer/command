import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL

/**
 * Plan-usage data pushed to the renderer.
 * Canonical declaration; mirrored in `src/types/index.ts` and inline in
 * `electron/preload/index.ts` because Electron process isolation prevents a
 * shared import. When you add or rename a field here, update the other two
 * declarations in the same commit.
 */
export interface UsageWindow {
  utilization: number
  resetsAt: string
}

export interface UsageData {
  status: 'ok' | 'unavailable'
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
  sevenDaySonnet?: UsageWindow
  extraUsage?: {
    usedCredits: number
    currency: string
  }
}

interface Credentials {
  accessToken: string
  expiresAt?: number
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
const POLL_INTERVAL = 60_000
/** Reduced cadence while the window is blurred: parallel sessions keep burning
 *  usage while the user works elsewhere, so a full pause would show stale data
 *  on a visible-but-unfocused window. */
const BLUR_POLL_INTERVAL = 300_000
const FETCH_TIMEOUT = 10_000

const UNAVAILABLE: UsageData = { status: 'unavailable' }

function getCredentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json')
}

/**
 * Parse the Claude Code credentials file content. Returns null on any
 * structural problem. Never include file content or the token in errors —
 * callers log fixed-string messages only.
 */
export function parseCredentials(raw: string): Credentials | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const oauth = (parsed as Record<string, unknown>).claudeAiOauth
    if (typeof oauth !== 'object' || oauth === null) return null
    const token = (oauth as Record<string, unknown>).accessToken
    if (typeof token !== 'string' || token.length === 0) return null
    const expiresAt = (oauth as Record<string, unknown>).expiresAt
    return {
      accessToken: token,
      expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
    }
  } catch {
    return null
  }
}

function mapWindow(value: unknown): UsageWindow | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.utilization !== 'number' || typeof v.resets_at !== 'string') return undefined
  return { utilization: v.utilization, resetsAt: v.resets_at }
}

/**
 * Map the raw endpoint response to UsageData. Returns null when the body is
 * structurally unusable (shape drift, wrong type) — callers treat that as
 * `unavailable` rather than rendering a misleading empty bar. A response
 * missing only optional blocks (`seven_day_sonnet`, `extra_usage`) maps fine;
 * at least one of `five_hour`/`seven_day` must be present to count as usable.
 */
export function mapUsageResponse(body: unknown): UsageData | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const fiveHour = mapWindow(b.five_hour)
  const sevenDay = mapWindow(b.seven_day)
  if (!fiveHour && !sevenDay) return null

  const data: UsageData = { status: 'ok' }
  if (fiveHour) data.fiveHour = fiveHour
  if (sevenDay) data.sevenDay = sevenDay
  const sonnet = mapWindow(b.seven_day_sonnet)
  if (sonnet) data.sevenDaySonnet = sonnet

  const extra = b.extra_usage
  if (typeof extra === 'object' && extra !== null) {
    const e = extra as Record<string, unknown>
    if (typeof e.used_credits === 'number' && typeof e.currency === 'string') {
      data.extraUsage = { usedCredits: e.used_credits, currency: e.currency }
    }
  }
  return data
}

/**
 * Classify a non-OK HTTP status. A 401/403 with a locally-expired token is
 * transient: Claude Code refreshes its token lazily (only when it next runs),
 * so an expired-token 401 at app start is pending-refresh, not revocation —
 * hiding the indicator there would make it vanish every morning.
 */
export function classifyHttpFailure(
  status: number,
  tokenExpiredLocally: boolean
): 'transient' | 'unavailable' {
  if (status === 401 || status === 403) {
    return tokenExpiredLocally ? 'transient' : 'unavailable'
  }
  if (status === 429 || status >= 500) return 'transient'
  return 'unavailable'
}

/**
 * Polls Anthropic's OAuth usage endpoint (the same source as Claude Code's
 * `/usage`) with the token Claude Code stores locally, and pushes derived
 * numbers to the renderer. The token never crosses the IPC boundary.
 *
 * Two independent gates control polling:
 * - `enabled` (persisted setting, via `setEnabled`): off = no timers at all
 * - focus (`pause`/`resume`): blurred = reduced cadence, focused = 60s
 */
export class UsageService {
  private window: BrowserWindow | null = null
  private enabled = false
  private focused = true
  private interval: ReturnType<typeof setInterval> | null = null
  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private lastPushed: string | null = null
  private polling = false

  setWindow(window: BrowserWindow) {
    this.window = window
  }

  /** Idempotent: repeated calls with the current value are no-ops. */
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (enabled) {
      // Force a fresh emit for the (possibly reloaded) renderer.
      this.lastPushed = null
      this.startTimers(true)
    } else {
      this.clearTimers()
    }
  }

  /** Window blurred: drop to the reduced cadence (no immediate poll). */
  pause() {
    this.focused = false
    if (this.enabled) this.startTimers(false)
  }

  /** Window focused: immediate catch-up poll, then full cadence. No-op while disabled. */
  resume() {
    this.focused = true
    if (this.enabled) this.startTimers(true)
  }

  private startTimers(immediate: boolean) {
    this.clearTimers()
    const period = this.focused ? POLL_INTERVAL : BLUR_POLL_INTERVAL
    if (immediate) {
      // Jittered first fetch so app launch doesn't race other startup work.
      const jitter = Math.floor(Math.random() * 4000) + 1000
      this.initialTimer = setTimeout(() => {
        void this.pollOnce()
      }, jitter)
    }
    this.interval = setInterval(() => {
      void this.pollOnce()
    }, period)
  }

  private clearTimers() {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer)
      this.initialTimer = null
    }
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  /**
   * One poll cycle. Transient failures (network, timeout, 5xx, 429,
   * 401-with-expired-token) emit nothing so the renderer keeps last-good data;
   * definitive failures emit `unavailable` once.
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const outcome = await this.fetchOutcome()
      if (outcome === 'transient') return
      this.emitIfChanged(outcome)
    } finally {
      this.polling = false
    }
  }

  private async fetchOutcome(): Promise<UsageData | 'transient'> {
    let raw: string
    try {
      raw = await readFile(getCredentialsPath(), 'utf-8')
    } catch {
      return UNAVAILABLE
    }
    const creds = parseCredentials(raw)
    if (!creds) {
      if (isDev) console.error('[Usage] credentials parse failed')
      return UNAVAILABLE
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    let res: Response
    try {
      res = await fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
        },
        signal: controller.signal,
      })
    } catch {
      return 'transient'
    } finally {
      clearTimeout(timeout)
    }

    if (!res.ok) {
      const tokenExpiredLocally = creds.expiresAt !== undefined && creds.expiresAt <= Date.now()
      const cls = classifyHttpFailure(res.status, tokenExpiredLocally)
      return cls === 'transient' ? 'transient' : UNAVAILABLE
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return UNAVAILABLE
    }
    return mapUsageResponse(body) ?? UNAVAILABLE
  }

  private emitIfChanged(data: UsageData) {
    const serialized = JSON.stringify(data)
    if (serialized === this.lastPushed) return
    this.lastPushed = serialized
    this.sendToRenderer('usage:update', data)
  }

  private sendToRenderer(channel: string, ...args: unknown[]) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args)
    }
  }

  destroy() {
    this.clearTimers()
    this.enabled = false
    this.lastPushed = null
    this.window = null
  }
}
