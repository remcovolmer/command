// Security config for <webview> guests (the built-in browser).
//
// The browser renders local HTML, localhost dev apps, and — at the user's own
// risk — arbitrary external pages. None of that content is trusted, so a guest
// must never gain Node access or reach the Electron preload bridge. The
// enforceable boundary is the main process: element attributes set in renderer
// markup are not trusted, so `will-attach-webview` re-derives the guest's
// webPreferences here regardless of what the <webview> tag declared.

/** Dedicated, app-isolated, persistent session for the browser webview.
 *  Persistent so cookies/localStorage survive restarts (real browser
 *  behaviour); isolated so it never shares the app's own session. The
 *  renderer sets the same value on the <webview partition> attribute, but the
 *  main process pins it here as the authoritative source. */
export const BROWSER_PARTITION = 'persist:command-browser'

// Structural subsets of Electron's WebPreferences / webview params — only the
// fields we mutate. Kept local so this stays unit-testable without an Electron
// runtime.
export interface WebviewPreferencesLike {
  preload?: string
  nodeIntegration?: boolean
  contextIsolation?: boolean
  sandbox?: boolean
  partition?: string
}

export interface WebviewAttachParamsLike {
  partition?: string
}

/**
 * Force a <webview> guest into a locked-down, app-isolated configuration.
 * Called from the host's `will-attach-webview` handler. Mutates both the
 * webPreferences and the attach params in place (Electron reads them back).
 */
export function hardenWebviewPreferences(
  webPreferences: WebviewPreferencesLike,
  params: WebviewAttachParamsLike
): void {
  // Strip any preload the element tried to inject — no bridge into the guest.
  delete webPreferences.preload
  webPreferences.nodeIntegration = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  // Pin the isolated persistent partition regardless of the element attribute.
  webPreferences.partition = BROWSER_PARTITION
  params.partition = BROWSER_PARTITION
}
