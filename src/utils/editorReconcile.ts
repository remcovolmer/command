/**
 * Pure decision helpers for the dual-pane markdown editor.
 *
 * The markdown editor keeps both panes (Monaco raw + Milkdown preview) mounted
 * and reconciles their content on toggle. The decisions below are extracted as
 * pure functions so they can be unit-tested without mounting Monaco/Milkdown,
 * which do not run in jsdom.
 */

/**
 * Whether the canonical content must be pushed into a pane on activation.
 *
 * `paneLastSynced` is the content the pane last received from (or wrote to) the
 * canonical buffer. We only push when the canonical content has actually moved
 * on since then — pushing on every toggle would rebuild the pane and reset its
 * scroll position, defeating the whole feature.
 */
export function needsSync(canonical: string, paneLastSynced: string): boolean {
  return canonical !== paneLastSynced
}

/** Whether the buffer is dirty relative to what is on disk. */
export function computeDirty(current: string, saved: string): boolean {
  return current !== saved
}

export type ReloadDecision = 'apply' | 'skip-echo' | 'skip-dirty'

/**
 * Decide how to handle an external (file-watcher) change in an editor with an
 * editable buffer:
 *  - `skip-echo`  — the change is the chokidar echo of our own save (disk equals
 *    what we just wrote, within the watcher batch window).
 *  - `skip-dirty` — the buffer has unsaved edits; keep the user's work rather
 *    than clobbering it. This holds even when disk happens to equal the last
 *    save (a spurious or same-content watcher event): reloading saved content
 *    over a dirty buffer would silently discard the user's edits, and there is
 *    nothing new on disk to adopt anyway.
 *  - `apply`      — refresh both panes from disk.
 */
export function decideExternalReload(params: {
  diskText: string
  savedContent: string
  isDirty: boolean
  msSinceSelfWrite: number
}): ReloadDecision {
  const { diskText, savedContent, isDirty, msSinceSelfWrite } = params
  if (diskText === savedContent && msSinceSelfWrite < 1000) return 'skip-echo'
  if (isDirty) return 'skip-dirty'
  return 'apply'
}
