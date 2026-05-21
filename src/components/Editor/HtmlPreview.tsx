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
 * Sandbox token set for the preview iframe. Exported so a unit test can lock
 * the security posture: any change here must be matched in HtmlPreview.test.ts.
 *
 * Why each token is on:
 *   - allow-scripts  : render real dashboards (charts, interactive HTML)
 *   - allow-forms    : <form> works for HTML that contains questionnaires/inputs
 *   - allow-modals   : alert()/confirm()/prompt() inside previewed HTML
 *   - allow-popups   : window.open(); the popup itself remains sandboxed
 *                      because allow-popups-to-escape-sandbox is NOT set
 *
 * Why these are deliberately omitted:
 *   - allow-same-origin            : with allow-scripts this would let the
 *                                    iframe reach window.parent.electronAPI
 *                                    (sandbox escape into the Electron bridge)
 *   - allow-top-navigation         : a previewed script could otherwise yank
 *                                    the user away from the editor
 *   - allow-popups-to-escape-sandbox: would let popups bypass the sandbox for
 *                                    network exfiltration
 */
export const IFRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups"

/**
 * Permissive CSP injected into preview srcdoc. The iframe sandbox omits
 * allow-same-origin, so it runs in an opaque null origin with no access to
 * the host's cookies/storage. Inside that null-origin sandbox we relax CSP
 * to what real-world HTML expects: inline scripts/styles, images from anywhere,
 * fetch from anywhere. Without this, the renderer's strict `script-src 'self'`
 * from index.html cascades into the iframe and blocks almost everything
 * previewed HTML wants to do.
 */
const PREVIEW_CSP = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: file:; img-src * data: blob: file:; style-src * 'unsafe-inline' data: blob: file:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob: file:; font-src * data: blob: file:; connect-src * data: blob: file:; frame-src * data: blob: file:;"

// HTML-attribute-escape so a path containing `"`, `<`, `>`, `&`, or `'` cannot
// break out of the <base href="..."> attribute and inject markup into srcdoc.
// POSIX filenames may contain double-quote; without this an attacker-controlled
// directory name could embed arbitrary HTML/JS in the previewed document.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

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
  const injection = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><base href="${escapeAttr(baseHref)}">`
  const headOpenMatch = content.match(/<head\b[^>]*>/i)
  if (headOpenMatch && headOpenMatch.index !== undefined) {
    const insertAt = headOpenMatch.index + headOpenMatch[0].length
    return content.slice(0, insertAt) + injection + content.slice(insertAt)
  }
  return injection + content
}

/**
 * Sandboxed iframe that renders HTML content with relative assets resolved
 * against `fileDir`. Scripts run; the iframe is in a null origin (no
 * allow-same-origin), so it has no access to window.parent, the host's
 * cookies/storage, or the Electron preload bridge. Top-level navigation
 * is blocked.
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
      // Sandbox set is in IFRAME_SANDBOX above; see the comment block there for
      // why each token is on and what is deliberately omitted.
      sandbox={IFRAME_SANDBOX}
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
