/**
 * Lightweight registry for "dismiss the topmost toast" keyboard handling.
 *
 * Each toast component pushes a dismiss function when a toast appears and pops
 * it when the toast is removed (or on unmount). dismissTopmost() invokes the
 * most-recently-pushed dismiss and returns whether anything was dismissed —
 * the hotkey handler uses that boolean to decide whether to consume the key.
 *
 * Module-level state is fine here: this is a single-window Electron app and
 * the registry is reset whenever the renderer reloads. No store/persist
 * machinery needed.
 */

type DismissHandle = { dismiss: () => void }

const stack: DismissHandle[] = []

export function pushToastDismiss(dismiss: () => void): () => void {
  const handle: DismissHandle = { dismiss }
  stack.push(handle)
  return () => {
    const idx = stack.lastIndexOf(handle)
    if (idx !== -1) stack.splice(idx, 1)
  }
}

/**
 * Dismiss the topmost (most recently pushed) toast. Returns true if a toast
 * was dismissed, false if the stack was empty.
 */
export function dismissTopmostToast(): boolean {
  const handle = stack.pop()
  if (!handle) return false
  handle.dismiss()
  return true
}

/** For tests: clear the registry between cases. */
export function _resetToastRegistry(): void {
  stack.length = 0
}
