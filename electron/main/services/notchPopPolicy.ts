import type { NotchSession, TerminalState } from '../../../shared/ipc-types'

/** How long a finished (done) session stays surfaced before auto-dismissing. */
export const FLASH_MS = 6000

export interface SurfacedEntry {
  state: TerminalState
  /** Auto-dismiss deadline (epoch ms) for a done flash; null = persistent. */
  deadline: number | null
}
export type SurfacedMap = Map<string, SurfacedEntry>

/**
 * Pure pop-policy step. Given the previous surfaced map, the current session
 * snapshot, and the clock, decide which sessions are surfaced:
 *
 * - done -> surfaced with a flash deadline; an existing deadline is preserved
 *   so a still-done session does not re-flash on every feed tick, and an
 *   expired flash is retained (so it stays dismissed until the session leaves
 *   'done')
 * - everything else (busy / permission / question / stopped) -> surfaced
 *   persistently (deadline null) while the session stays in that state
 *
 * Every live agent session therefore keeps the strip present while Command is
 * backgrounded (the live overview); only a finished session flashes and clears.
 *
 * Returns the next map (carried as `prev` into the following call) and the
 * earliest future flash deadline, so the caller can schedule a re-evaluation
 * that hides the strip when a flash expires without a new feed update.
 */
export function computeSurfaced(
  prev: SurfacedMap,
  sessions: NotchSession[],
  now: number,
  flashMs = FLASH_MS,
): { entries: SurfacedMap; nextDeadline: number | null } {
  const entries: SurfacedMap = new Map()
  let nextDeadline: number | null = null

  for (const s of sessions) {
    if (s.state === 'done') {
      const prevEntry = prev.get(s.id)
      const deadline =
        prevEntry && prevEntry.state === 'done' && prevEntry.deadline !== null
          ? prevEntry.deadline
          : now + flashMs
      entries.set(s.id, { state: 'done', deadline })
      if (now < deadline && (nextDeadline === null || deadline < nextDeadline)) {
        nextDeadline = deadline
      }
    } else {
      // busy / permission / question / stopped: shown while in that state.
      entries.set(s.id, { state: s.state, deadline: null })
    }
  }

  return { entries, nextDeadline }
}

/** Ids currently surfaced at `now` (persistent, or a flash not yet expired). */
export function activeSurfacedIds(entries: SurfacedMap, now: number): string[] {
  const ids: string[] = []
  for (const [id, e] of entries) {
    if (e.deadline === null || now < e.deadline) ids.push(id)
  }
  return ids
}
