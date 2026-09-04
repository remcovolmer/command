/**
 * Renderer-side platform detection. Uses navigator.platform (same idiom as
 * hotkeys.ts's ⌘ labels) so all platform-dependent chrome agrees.
 */
const platform = () => (typeof navigator === 'undefined' ? '' : navigator.platform.toUpperCase())

/** True on macOS — traffic-light-safe padding in the title bar. */
export function isMac(): boolean {
  return platform().includes('MAC')
}

export function isWindows(): boolean {
  return platform().includes('WIN')
}

/**
 * Whether main draws the window without its native title bar (win32: hidden +
 * overlay buttons, darwin: hiddenInset). Mirrors createWindow in
 * electron/main/index.ts — Linux keeps the native frame, so the renderer must
 * not paint a second title bar there.
 */
export function hasCustomTitleBar(): boolean {
  return isMac() || isWindows()
}
