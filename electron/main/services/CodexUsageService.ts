import { access, open, readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { type BrowserWindow } from 'electron'
import type { UsageData, UsageWindow } from '../../../shared/ipc-types'

// Intentionally logs nothing: rollout files contain the user's own prompts
// (PII), so the reader never writes file content or a token to the log. All
// read failures degrade silently to `unavailable` / last-good.

const POLL_INTERVAL = 60_000
/** Reduced cadence while the window is blurred — mirrors UsageService. */
const BLUR_POLL_INTERVAL = 300_000
/** Scan at most this many recent rollout files for a `rate_limits` event before
 *  giving up. A just-started session may not have written one yet, so the
 *  newest file isn't guaranteed to carry the snapshot. */
const MAX_ROLLOUTS_SCANNED = 5
/** Only stat this many newest-by-name rollout candidates per poll — rollout
 *  paths are time-ordered, so a name sort is a zero-syscall recency proxy that
 *  avoids stat-ing the user's entire Codex history every tick. */
const CANDIDATE_WINDOW = 20
/** Read only this many trailing bytes of a rollout: `rate_limits` events are
 *  written every turn, so a recent snapshot sits near EOF. Full-read fallback
 *  covers the rare case where the only snapshot straddles the tail boundary. */
const TAIL_BYTES = 256 * 1024

const UNAVAILABLE: UsageData = { provider: 'codex', status: 'unavailable' }

function getAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json')
}

function getSessionsDir(): string {
  return join(homedir(), '.codex', 'sessions')
}

/**
 * Map a Codex `window_minutes` value to a short display label. Codex reports
 * generic windows, so the label is derived from the size rather than a fixed
 * field name: 300 → "5h", 10080 → "wk".
 */
export function windowLabelFromMinutes(minutes: number): string {
  if (minutes === 300) return '5h'
  if (minutes === 10080) return 'wk'
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

interface MappedWindow {
  minutes: number
  /** Reset time as a unix epoch in seconds, or null when absent. */
  resetEpoch: number | null
  window: UsageWindow
}

function mapWindow(raw: unknown): MappedWindow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.used_percent !== 'number' || typeof r.window_minutes !== 'number') return null
  const resetEpoch = typeof r.resets_at === 'number' ? r.resets_at : null
  const resetsAt = resetEpoch !== null ? new Date(resetEpoch * 1000).toISOString() : ''
  return {
    minutes: r.window_minutes,
    resetEpoch,
    window: {
      utilization: r.used_percent,
      resetsAt,
      label: windowLabelFromMinutes(r.window_minutes),
    },
  }
}

/**
 * Map a raw Codex `rate_limits` block to UsageData. Returns null when no usable
 * window is present (shape drift), so callers treat that as `unavailable`.
 *
 * The **rendered window** is the shortest present window (Codex reports a 5h
 * and/or a weekly window; recent rollouts are weekly-only). Staleness keys off
 * that window: once its `resets_at` has passed, the pre-reset percentage no
 * longer reflects the current window, so the snapshot maps to `unavailable`. An
 * absent `resets_at` is guarded so a weekly-only snapshot never compares `NaN`.
 * `used_percent` is a 0–100 value, copied straight through.
 */
export function mapRateLimits(raw: unknown, now: number = Date.now()): UsageData | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rl = raw as Record<string, unknown>

  const mapped = [mapWindow(rl.primary), mapWindow(rl.secondary)].filter(
    (m): m is MappedWindow => m !== null
  )
  if (mapped.length === 0) return null
  mapped.sort((a, b) => a.minutes - b.minutes)

  // Staleness on the rendered (shortest present) window; guard an absent reset.
  const rendered = mapped[0]
  if (rendered.resetEpoch !== null && rendered.resetEpoch * 1000 <= now) {
    return UNAVAILABLE
  }

  const data: UsageData = { provider: 'codex', status: 'ok' }
  for (const m of mapped) {
    if (m.minutes < 1440) data.fiveHour = m.window
    else data.sevenDay = m.window
  }

  if (typeof rl.plan_type === 'string') data.planType = rl.plan_type
  const credits = rl.credits
  if (typeof credits === 'object' && credits !== null) {
    const c = credits as Record<string, unknown>
    if (
      typeof c.has_credits === 'boolean' &&
      (typeof c.balance === 'string' || typeof c.balance === 'number')
    ) {
      data.credits = { hasCredits: c.has_credits, balance: String(c.balance) }
    }
  }
  return data
}

/**
 * Extract the last `rate_limits` block from a rollout file's JSONL content.
 * Scans lines from the end and tolerates malformed lines. Returns null when the
 * file carries no `token_count` event with a `rate_limits` block.
 */
export function parseRateLimitsFromContent(content: string): unknown {
  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line || !line.includes('rate_limits')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const payload = (parsed as Record<string, unknown>).payload
    if (typeof payload !== 'object' || payload === null) continue
    const p = payload as Record<string, unknown>
    if (p.type !== 'token_count') continue
    if (typeof p.rate_limits === 'object' && p.rate_limits !== null) {
      return p.rate_limits
    }
  }
  return null
}

/**
 * Reads Codex's locally-persisted rate-limit snapshot from the newest session
 * rollout file and pushes derived numbers to the renderer on the same
 * `usage:update` channel as UsageService (tagged `provider: 'codex'`). No
 * network, no token: `~/.codex/auth.json` is checked for existence only, and
 * the rollout files are read for their `rate_limits` block alone.
 *
 * Lifecycle mirrors UsageService: an `enabled` gate (persisted setting) and a
 * focus gate (blurred = reduced cadence).
 */
export class CodexUsageService {
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

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) {
      if (enabled) {
        this.lastPushed = null
        void this.pollOnce()
      }
      return
    }
    this.enabled = enabled
    if (enabled) {
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
   * One poll cycle. `skip` (no Codex auth and no prior emit) and `transient`
   * (recoverable read error) emit nothing so the renderer keeps last-good data;
   * a `UsageData` outcome emits when it changed.
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const outcome = await this.fetchOutcome()
      if (outcome === 'transient' || outcome === 'skip') return
      this.emitIfChanged(outcome)
    } finally {
      this.polling = false
    }
  }

  private async fetchOutcome(): Promise<UsageData | 'transient' | 'skip'> {
    // Presence check only — never read auth.json, which holds the OAuth token.
    try {
      await access(getAuthPath())
    } catch {
      // No Codex auth: never surface a Codex row unless one was already shown
      // (auth removed mid-session drops the row to the placeholder).
      return this.lastPushed === null ? 'skip' : UNAVAILABLE
    }

    let files: string[]
    try {
      files = await this.listRolloutFiles()
    } catch (err) {
      // A missing sessions dir is definitive (no data yet). Other fs errors —
      // too-many-open-files, an AV/indexer lock — are transient: keep last-good
      // rather than flash the placeholder for one tick.
      const code = (err as { code?: string }).code
      if (code && code !== 'ENOENT' && this.lastPushed !== null) return 'transient'
      return UNAVAILABLE
    }
    if (files.length === 0) return UNAVAILABLE

    // Use the freshest snapshot that carries a rate_limits block. It renders
    // whatever windows Codex currently reports — the 5h window when OpenAI sends
    // one (shown like the Claude bar), otherwise the weekly window. We show what
    // the API reports; we don't dig older files for a window it has stopped
    // sending.
    for (const file of files.slice(0, MAX_ROLLOUTS_SCANNED)) {
      const content = await this.readRolloutContent(file)
      if (content === null) continue
      const raw = parseRateLimitsFromContent(content)
      if (raw === null) continue
      return mapRateLimits(raw) ?? UNAVAILABLE
    }
    return UNAVAILABLE
  }

  /** Rollout file paths under `~/.codex/sessions`, newest (by mtime) first. */
  private async listRolloutFiles(): Promise<string[]> {
    const dir = getSessionsDir()
    const entries = await readdir(dir, { recursive: true })
    const rollouts = (entries as string[]).filter(
      (e) => typeof e === 'string' && /rollout-.*\.jsonl$/.test(e)
    )
    // The dir (YYYY/MM/DD) and filename (rollout-<ISO>-<uuid>) are both
    // lexicographically time-ordered, so a descending name sort is a
    // zero-syscall proxy for recency. Stat only the newest candidates to
    // resolve exact mtime order (an appended-to session can outrank its name).
    rollouts.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    const withMtime = await Promise.all(
      rollouts.slice(0, CANDIDATE_WINDOW).map(async (rel) => {
        const path = join(dir, rel)
        try {
          const s = await stat(path)
          return { path, mtimeMs: s.mtimeMs }
        } catch {
          return { path, mtimeMs: 0 }
        }
      })
    )
    withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return withMtime.map((f) => f.path)
  }

  /**
   * Read a rollout for its `rate_limits` snapshot without pulling a whole
   * multi-MB transcript into memory each poll: read the trailing `TAIL_BYTES`
   * (where recent snapshots live) and fall back to a full read only when the
   * tail carries none. Returns null when the file can't be read.
   */
  private async readRolloutContent(file: string): Promise<string | null> {
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      return null
    }
    if (size <= TAIL_BYTES) {
      try {
        return await readFile(file, 'utf-8')
      } catch {
        return null
      }
    }
    let tail: string | null = null
    try {
      const handle = await open(file, 'r')
      try {
        const buf = Buffer.alloc(TAIL_BYTES)
        const { bytesRead } = await handle.read(buf, 0, TAIL_BYTES, size - TAIL_BYTES)
        tail = buf.toString('utf-8', 0, bytesRead)
      } finally {
        await handle.close()
      }
    } catch {
      tail = null
    }
    if (tail !== null && parseRateLimitsFromContent(tail) !== null) return tail
    // Tail had no snapshot (or the read failed) — fall back to the full file.
    try {
      return await readFile(file, 'utf-8')
    } catch {
      return tail
    }
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
