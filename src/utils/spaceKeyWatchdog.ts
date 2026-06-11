/**
 * Recovers space keystrokes that an OS-level IME/text-suggestion layer eats.
 *
 * On Windows, an input-method layer can intermittently deliver plain space
 * keydowns as keyCode 229 ("processed by IME") without inserting a space into
 * xterm's hidden textarea. xterm.js never processes keyCode-229 keydowns as
 * keys (CompositionHelper.keydown) and only forwards textarea diffs — so the
 * space silently vanishes while every other character still arrives via the
 * diff path. The state persists until the textarea blurs (e.g. switching
 * windows), which resets the IME.
 *
 * Instead of pattern-matching the broken event shape (key/keyCode values vary
 * per IME layer), this watchdog observes outcomes: every plain space keydown
 * arms a short timer, and any user-input data containing a space disarms it.
 * In the normal path xterm emits the space synchronously during the same
 * keydown dispatch, so the timer only ever fires when the space was dropped.
 *
 * Real IME composition (e.g. CJK input) is excluded via event.isComposing —
 * there, space legitimately selects a candidate and must not be injected.
 */

interface SpaceKeyEvent {
  type: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  isComposing: boolean
}

export interface SpaceKeyWatchdog {
  /** Call for every key event seen by xterm's custom key event handler. */
  handleKeyEvent(event: SpaceKeyEvent): void
  /** Call with every user-input chunk xterm emits (terminal.onData). */
  handleData(data: string): void
  dispose(): void
}

interface SpaceKeyWatchdogOptions {
  /** Called when a space keydown produced no space data within the window. */
  writeSpace: () => void
  /** How long to wait for the space to arrive before injecting (ms). */
  windowMs?: number
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable scheduler for tests. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
}

// The normal keyboard path emits data synchronously within the keydown
// dispatch; composition flushes use setTimeout(0). 80ms covers both with
// margin while keeping injected spaces imperceptible.
const DEFAULT_WINDOW_MS = 80

export function createSpaceKeyWatchdog(options: SpaceKeyWatchdogOptions): SpaceKeyWatchdog {
  const {
    writeSpace,
    windowMs = DEFAULT_WINDOW_MS,
    now = () => performance.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
  } = options

  let lastSpaceDataAt = Number.NEGATIVE_INFINITY
  let disposed = false
  const timers = new Set<ReturnType<typeof setTimeout>>()

  return {
    handleKeyEvent(event: SpaceKeyEvent): void {
      if (disposed) return
      if (event.type !== 'keydown' || event.code !== 'Space') return
      // Modified spaces (Ctrl+Space etc.) map to control sequences, not ' '.
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (event.isComposing) return

      const pressedAt = now()
      const timer = schedule(() => {
        timers.delete(timer)
        if (disposed) return
        if (lastSpaceDataAt >= pressedAt) return
        writeSpace()
      }, windowMs)
      timers.add(timer)
    },

    handleData(data: string): void {
      if (data.includes(' ')) {
        lastSpaceDataAt = now()
      }
    },

    dispose(): void {
      disposed = true
      for (const timer of timers) {
        clearTimeout(timer)
      }
      timers.clear()
    },
  }
}
