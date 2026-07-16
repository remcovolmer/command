// Builds the chat messages the browser annotation modes send, and routes them
// to the active agent chat. Pure + dependency-injected so it needs no store or
// IPC mock to test — the caller passes the store snapshot and the write fn.
//
// Note on chunking: we deliberately do NOT chunk here. terminal.write reaches
// TerminalManager.writePtySafe, which already splits payloads at 512 B with
// flow control and bracketed-paste handling (see
// docs/solutions/integration-issues/node-pty-paste-truncation.md). Re-chunking
// would double-handle. Messages land in the input; the user submits with Enter.

export interface CommentAnnotation {
  url: string
  selector: string
  snippet: string
  comment: string
}

export interface EditAnnotation {
  url: string
  selector: string
  before: string
  after: string
}

export interface DrawAnnotation {
  url: string
}

// Every field below is page-controlled (a comment box, a selection, outerHTML,
// the URL) and is written raw into the active Claude terminal's PTY. Strip C0
// control bytes except \n and \t before interpolating: \r is what Enter sends
// (it would submit the prompt early) and ESC (\x1b) opens terminal escape
// sequences. Newlines and tabs stay, so a legit multi-line snippet or edit is
// preserved. Belt-and-suspenders against a hostile page forging these fields;
// see the guest->host channel note in annotationGuestScript.ts.
export function sanitizeField(value: string): string {
  // Strips 0x00-0x08, 0x0B-0x1F (incl. \r and ESC) and 0x7F; keeps \t and \n.
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}

export function buildCommentMessage({ url, selector, snippet, comment }: CommentAnnotation): string {
  return [
    `Browser-annotatie op ${sanitizeField(url)}`,
    `Selector: ${sanitizeField(selector)}`,
    '',
    'Geselecteerd:',
    sanitizeField(snippet),
    '',
    `Opmerking: ${sanitizeField(comment)}`,
  ].join('\n')
}

export function buildEditMessage({ url, selector, before, after }: EditAnnotation): string {
  return [
    `Browser-annotatie (inline edit) op ${sanitizeField(url)}`,
    `Selector: ${sanitizeField(selector)}`,
    '',
    'Verander deze tekst:',
    sanitizeField(before),
    '',
    'Naar:',
    sanitizeField(after),
  ].join('\n')
}

export function buildDrawMessage({ url }: DrawAnnotation): string {
  return [
    `Browser-annotatie (tekening) op ${sanitizeField(url)}`,
    'De bijgevoegde afbeelding toont mijn markering op de pagina — plak met Alt+V.',
  ].join('\n')
}

// ---- Direct local-file edit (mode 2 on a file:// page) --------------------
// A text edit on a local .html file maps straight to that file, so we apply it
// directly — no agent, no tokens. Dev-server pages (component output, no single
// source file) and ambiguous matches fall back to the agent instead.

/** Convert a file:// URL to a local filesystem path, or null when not file://. */
export function fileUrlToLocalPath(url: string): string | null {
  if (!url.startsWith('file://')) return null
  try {
    const pathname = decodeURIComponent(new URL(url).pathname)
    // Windows drive paths arrive as '/C:/Users/x.html' — drop the leading slash.
    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
  } catch {
    return null
  }
}

export type DirectEditResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'not-found' | 'ambiguous' }

// Replace `needle` in `content` iff it occurs exactly once. A discriminated
// result — not a bare string, since the 'none'/'many' sentinels would be
// indistinguishable from a replaced string — so the caller can try a narrower
// or wider match.
type ReplaceResult = { status: 'ok'; content: string } | { status: 'none' } | { status: 'many' }

function replaceIfUnique(content: string, needle: string, replacement: string): ReplaceResult {
  if (!needle) return { status: 'none' }
  const first = content.indexOf(needle)
  if (first === -1) return { status: 'none' }
  if (content.indexOf(needle, first + needle.length) !== -1) return { status: 'many' }
  return {
    status: 'ok',
    content: content.slice(0, first) + replacement + content.slice(first + needle.length),
  }
}

const EDIT_CONTEXT = 24

// The minimal changed span between before/after (common prefix/suffix stripped)
// plus a little surrounding context for disambiguation. Exported for tests.
export function minimalEdit(before: string, after: string) {
  // Scan by Unicode code point, not UTF-16 code unit: Array.from splits on code
  // points, so a prefix/suffix boundary never lands inside a surrogate pair (an
  // emoji edit would otherwise yield a lone surrogate half as the search needle,
  // which mis-matches unrelated astral chars sharing that half).
  const b = Array.from(before)
  const a = Array.from(after)
  const max = Math.min(b.length, a.length)
  let p = 0
  while (p < max && b[p] === a[p]) p++
  let s = 0
  while (s < max - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s++
  return {
    coreBefore: b.slice(p, b.length - s).join(''),
    coreAfter: a.slice(p, a.length - s).join(''),
    ctxLeft: b.slice(Math.max(0, p - EDIT_CONTEXT), p).join(''),
    ctxRight: b.slice(b.length - s, b.length - s + EDIT_CONTEXT).join(''),
  }
}

/**
 * Apply an inline text edit to file content. Rendered innerText rarely matches
 * source verbatim (collapsed whitespace, inline tags, entities), so beyond a
 * direct whole-text match we diff before/after down to the changed span and
 * replace just that — which is usually a clean, unique substring of the source.
 * Falls back (not-found/ambiguous) so the caller hands off to the agent.
 */
export function applyDirectEdit(content: string, before: string, after: string): DirectEditResult {
  if (!before || before === after) return { ok: false, reason: 'not-found' }

  // 1. Whole selection, verbatim and unique — cleanest when the source matches.
  const whole = replaceIfUnique(content, before, after)
  if (whole.status === 'ok') return { ok: true, content: whole.content }

  const { coreBefore, coreAfter, ctxLeft, ctxRight } = minimalEdit(before, after)

  // 2. Substitution/deletion: replace just the changed span.
  if (coreBefore) {
    const core = replaceIfUnique(content, coreBefore, coreAfter)
    if (core.status === 'ok') return { ok: true, content: core.content }
    if (core.status === 'many') {
      // 3. Disambiguate a repeated span with its surrounding context.
      const keyed = replaceIfUnique(
        content,
        ctxLeft + coreBefore + ctxRight,
        ctxLeft + coreAfter + ctxRight
      )
      if (keyed.status === 'ok') return { ok: true, content: keyed.content }
      return { ok: false, reason: 'ambiguous' }
    }
    return { ok: false, reason: 'not-found' }
  }

  // 4. Pure insertion: anchor on the junction context.
  const anchor = ctxLeft + ctxRight
  if (anchor) {
    const inserted = replaceIfUnique(content, anchor, ctxLeft + coreAfter + ctxRight)
    if (inserted.status === 'ok') return { ok: true, content: inserted.content }
    if (inserted.status === 'many') return { ok: false, reason: 'ambiguous' }
  }
  return { ok: false, reason: 'not-found' }
}

interface TerminalLike {
  id: string
  type: string
}

interface ChatStateLike {
  activeTerminalId: string | null
  terminals: Record<string, TerminalLike>
}

/** The active terminal's id when it is an agent chat (any type except 'normal'), else null. */
export function resolveActiveAgentTerminalId(state: ChatStateLike): string | null {
  const id = state.activeTerminalId
  if (!id) return null
  const terminal = state.terminals[id]
  return terminal && terminal.type !== 'normal' ? terminal.id : null
}

export type SendResult = { ok: true; terminalId: string } | { ok: false; reason: 'no-active-chat' }

/**
 * Write an annotation message to the active agent chat. Returns a guard result
 * (no write) when there is no active agent terminal, so the UI can prompt the
 * user to focus a chat first (R3).
 */
export function sendAnnotationToChat(
  text: string,
  state: ChatStateLike,
  write: (terminalId: string, data: string) => void
): SendResult {
  const terminalId = resolveActiveAgentTerminalId(state)
  if (!terminalId) return { ok: false, reason: 'no-active-chat' }
  write(terminalId, text)
  return { ok: true, terminalId }
}
