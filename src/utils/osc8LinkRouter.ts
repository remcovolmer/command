/**
 * Decides what to do with an OSC 8 hyperlink URI emitted in a chat terminal.
 *
 * Claude Code wraps every markdown link in OSC 8 with a bare relative path as
 * the URI (e.g., `docs/foo.md`, no `file://` prefix, no URL encoding, no line
 * numbers). It also OSC 8-wraps `https://…` URLs (e.g., the session footer).
 * Plain prose mentions of paths are NOT wrapped — those go through
 * `fileLinkProvider.ts` instead.
 *
 * This module is pure (no I/O) so the security-relevant URI parsing has one
 * tested chokepoint. The caller does the I/O: `fs.stat` for existence +
 * containment, `shell.openExternal` for URLs.
 */

export type Osc8Decision =
  | { kind: 'editor'; resolved: string; fileName: string }
  | { kind: 'external'; url: string }
  | { kind: 'ignore'; reason: string }

const MAX_URI_LENGTH = 2000
const HTTP_SCHEME_RE = /^https?:\/\//i
const ANY_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/
const ALLOWED_EXTENSIONS = ['.md', '.html', '.htm'] as const

export function classifyOsc8Uri(uri: string, basePath: string): Osc8Decision {
  if (typeof uri !== 'string') return { kind: 'ignore', reason: 'non-string URI' }

  const trimmed = uri.trim()
  if (trimmed.length === 0) return { kind: 'ignore', reason: 'empty URI' }
  if (trimmed.length > MAX_URI_LENGTH) return { kind: 'ignore', reason: 'URI exceeds length limit' }

  if (HTTP_SCHEME_RE.test(trimmed)) return { kind: 'external', url: trimmed }

  if (WINDOWS_DRIVE_RE.test(trimmed)) return { kind: 'ignore', reason: 'absolute Windows path' }
  if (ANY_SCHEME_RE.test(trimmed)) return { kind: 'ignore', reason: 'unsupported scheme' }

  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return { kind: 'ignore', reason: 'absolute path' }
  }

  const segments = trimmed.split(/[/\\]/)
  if (segments.some((s) => s === '..')) {
    return { kind: 'ignore', reason: 'path traversal' }
  }

  const lower = trimmed.toLowerCase()
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { kind: 'ignore', reason: 'extension not allowed' }
  }

  if (typeof basePath !== 'string' || basePath.length === 0) {
    return { kind: 'ignore', reason: 'missing base path' }
  }

  const baseTrimmed = basePath.replace(/[\\/]+$/, '')
  const resolved = `${baseTrimmed}/${trimmed}`
  const fileName = segments[segments.length - 1]

  return { kind: 'editor', resolved, fileName }
}
