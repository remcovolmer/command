/**
 * Whether the MAIN window's renderer may navigate to `targetUrl`. The app UI
 * is a single page: any top-level navigation away from it (a file dropped on
 * the window → file://…, a stray link) would replace the whole UI and kill
 * every chat's renderer state. Allowed: staying on the current document (path
 * equal, hash ignored) and, in dev, the Vite dev-server origin (HMR reloads).
 * Reloads don't fire will-navigate, so they're unaffected either way.
 */
export function isAllowedMainWindowNavigation(
  targetUrl: string,
  currentUrl: string,
  devServerUrl: string | undefined
): boolean {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return false
  }
  if (devServerUrl) {
    try {
      if (target.origin === new URL(devServerUrl).origin) return true
    } catch {
      // Malformed dev-server URL: fall through to the same-document check.
    }
  }
  try {
    const current = new URL(currentUrl)
    current.hash = ''
    target.hash = ''
    return target.href === current.href
  } catch {
    return false
  }
}
