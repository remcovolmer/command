import { useMemo } from 'react'

interface HtmlPreviewProps {
  content: string
  fileDir: string
  isActive: boolean
}

/**
 * Builds a `file://` base href from an absolute directory path.
 * Normalizes backslashes for Windows and ensures a trailing slash so relative
 * resolutions append (rather than replace) the final path segment.
 */
export function buildBaseHref(fileDir: string): string {
  let normalized = fileDir.replace(/\\/g, '/')
  if (!normalized.endsWith('/')) normalized += '/'
  // Absolute Windows paths (e.g. C:/foo) need three slashes after file:.
  // POSIX absolute paths already start with /, so a single file:// prefix yields file:///foo/.
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  return prefix + normalized
}

/**
 * Permissive CSP injected into preview srcdoc. The iframe is already sandboxed
 * with allow-scripts (no allow-same-origin), so it runs in a null origin with
 * no access to the host's cookies/storage. Inside that null-origin sandbox we
 * relax CSP to what real-world HTML expects: inline scripts/styles, images
 * from anywhere, fetch from anywhere. Without this, the renderer's strict
 * `script-src 'self'` from index.html cascades into the iframe and blocks
 * almost everything previewed HTML wants to do.
 */
const PREVIEW_CSP = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: file:; img-src * data: blob: file:; style-src * 'unsafe-inline' data: blob: file:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob: file:; font-src * data: blob: file:; connect-src * data: blob: file:; frame-src * data: blob: file:;"

/**
 * Returns `content` with a CSP meta and `<base href>` tag injected so relative
 * asset references resolve against the file's directory and the iframe's CSP
 * permits inline scripts/styles. Strategy:
 *   - If a `<head>` exists, inject immediately after it.
 *   - Otherwise, prepend the tags to the document.
 * Order matters: CSP meta must come before any resource-fetching tag for the
 * browser to honor it. An existing `<base>` in the document overrides ours by
 * declaration order, which is the desired behavior.
 */
export function injectBaseHref(content: string, baseHref: string): string {
  const injection = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><base href="${baseHref}">`
  const headOpenMatch = content.match(/<head\b[^>]*>/i)
  if (headOpenMatch && headOpenMatch.index !== undefined) {
    const insertAt = headOpenMatch.index + headOpenMatch[0].length
    return content.slice(0, insertAt) + injection + content.slice(insertAt)
  }
  return injection + content
}

/**
 * Sandboxed iframe that renders HTML content with relative assets resolved
 * against `fileDir`. Scripts run; cookies/storage are isolated (no
 * allow-same-origin); top-level navigation is blocked.
 *
 * Pure presentation -- no file IO, no debounce. The parent owns content state
 * and decides when to update.
 */
export function HtmlPreview({ content, fileDir, isActive }: HtmlPreviewProps) {
  const srcDoc = useMemo(
    () => injectBaseHref(content, buildBaseHref(fileDir)),
    [content, fileDir]
  )

  return (
    <iframe
      title="HTML preview"
      // Threat model: previewed HTML lives in the user's workspace -- same
      // trust level as code they run via npm install or in a terminal.
      // We omit `allow-top-navigation` to keep the editor safe from a script
      // yanking the user away via location.href; everything else needed for
      // realistic dashboards (storage, ES modules, forms, modals, popups) is on.
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{
        display: isActive ? 'block' : 'none',
        border: 0,
        width: '100%',
        height: '100%',
        background: 'white',
      }}
    />
  )
}
