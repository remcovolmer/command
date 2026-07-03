// URL helpers for the built-in browser (<webview>). Kept pure so the
// Windows-path normalization lives in one tested place — the drive-letter
// three-slash rule is easy to get subtly wrong when duplicated.

/**
 * Convert an absolute filesystem path to a `file://` URL the webview can load.
 * Windows paths (`C:\a\b`) need three slashes: `file:///C:/a/b`. POSIX absolute
 * paths already start with `/`, so `file://` + `/a/b` yields `file:///a/b`.
 *
 * Each path segment is percent-encoded with `encodeURIComponent` so spaces and
 * URL-significant characters (`#`, `?`, `%`, `&`) in a filename can't truncate
 * the path or be misread as a fragment/query. The `/` separators and the drive
 * colon (`C:`) are preserved.
 */
export function pathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
    .join('/')
  return prefix + encoded
}

/**
 * Normalize raw address-bar text into a loadable URL. `file://` and
 * `http(s)://` inputs pass through; anything else is treated as a bare host and
 * gets an `http://` prefix (so `localhost:5173` works). Returns `null` for
 * empty input.
 */
export function normalizeAddressBarInput(raw: string): string | null {
  const next = raw.trim()
  if (!next) return null
  if (/^https?:\/\//i.test(next) || next.startsWith('file://')) return next
  return `http://${next}`
}
