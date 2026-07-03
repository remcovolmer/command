// Builds the chat messages the browser annotation modes send, and routes them
// to the active Claude chat. Pure + dependency-injected so it needs no store or
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

export function buildCommentMessage({ url, selector, snippet, comment }: CommentAnnotation): string {
  return [
    `Browser-annotatie op ${url}`,
    `Selector: ${selector}`,
    '',
    'Geselecteerd:',
    snippet,
    '',
    `Opmerking: ${comment}`,
  ].join('\n')
}

export function buildEditMessage({ url, selector, before, after }: EditAnnotation): string {
  return [
    `Browser-annotatie (inline edit) op ${url}`,
    `Selector: ${selector}`,
    '',
    'Verander deze tekst:',
    before,
    '',
    'Naar:',
    after,
  ].join('\n')
}

export function buildDrawMessage({ url }: DrawAnnotation): string {
  return [
    `Browser-annotatie (tekening) op ${url}`,
    'De bijgevoegde afbeelding toont mijn markering op de pagina — plak met Alt+V.',
  ].join('\n')
}

interface TerminalLike {
  id: string
  type: string
}

interface ChatStateLike {
  activeTerminalId: string | null
  terminals: Record<string, TerminalLike>
}

/** The active terminal's id when it is a Claude chat (type 'claude'), else null. */
export function resolveActiveClaudeTerminalId(state: ChatStateLike): string | null {
  const id = state.activeTerminalId
  if (!id) return null
  const terminal = state.terminals[id]
  return terminal && terminal.type === 'claude' ? terminal.id : null
}

export type SendResult = { ok: true; terminalId: string } | { ok: false; reason: 'no-active-chat' }

/**
 * Write an annotation message to the active Claude chat. Returns a guard result
 * (no write) when there is no active Claude terminal, so the UI can prompt the
 * user to focus a chat first (R3).
 */
export function sendAnnotationToChat(
  text: string,
  state: ChatStateLike,
  write: (terminalId: string, data: string) => void
): SendResult {
  const terminalId = resolveActiveClaudeTerminalId(state)
  if (!terminalId) return { ok: false, reason: 'no-active-chat' }
  write(terminalId, text)
  return { ok: true, terminalId }
}
