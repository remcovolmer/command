import type { NotchSession } from '../../../shared/ipc-types'

/**
 * Pure pop-policy: which session ids the notch strip currently surfaces.
 *
 * Every live agent session is surfaced while Command is backgrounded — the
 * live overview — EXCEPT a finished (done) session the user has already seen.
 * "Seen" means Command was focused while the session was done; the caller
 * (NotchService) records those ids in `acknowledgedDone`. A finished session
 * therefore stays visible until you return to Command, then clears, and
 * surfaces anew only if it finishes again (the caller drops the acknowledgement
 * once the session leaves the done state).
 */
export function computeSurfacedIds(
  sessions: NotchSession[],
  acknowledgedDone: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>()
  for (const s of sessions) {
    if (s.state === 'done' && acknowledgedDone.has(s.id)) continue
    ids.add(s.id)
  }
  return ids
}
