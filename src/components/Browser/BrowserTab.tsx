import { useEffect, useRef, useState } from 'react'
import { RotateCw, ArrowRight, ArrowLeft, ChevronRight, Wrench, MessageSquare, Highlighter } from 'lucide-react'
import { normalizeAddressBarInput } from '../../utils/browserUrls'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath } from '../../utils/paths'
import { getElectronAPI } from '../../utils/electron'
import { useProjectStore } from '../../stores/projectStore'
import { execInGuest, captureGuest } from '../../utils/webviewControl'
import {
  installEditContextMenuScript,
  enableCommentInspectScript,
  enableMarkupScript,
  resetMarkupScript,
  clearAnnotationsScript,
  parseEditSaveMessage,
  parseMarkupMessage,
  parseCommentMessage,
} from '../../utils/annotationGuestScript'
import type { EditResult, CommentPayload } from '../../utils/annotationGuestScript'
import {
  buildCommentMessage,
  buildEditMessage,
  buildDrawMessage,
  sendAnnotationToChat,
  fileUrlToLocalPath,
  applyDirectEdit,
} from '../../utils/annotationMessage'
import { applyDomEdit } from '../../utils/htmlEdit'
import type { FileWatchEvent } from '../../types'
import type { CommandWebviewElement } from '../../types/webview'

interface BrowserTabProps {
  url: string
  isActive: boolean
  onUrlChange: (url: string) => void
  // Set when the tab backs a local file — enables live-reload on disk change.
  filePath?: string
  projectId?: string
}

const RELOAD_DEBOUNCE_MS = 200

// Persistent, app-isolated session. Must match BROWSER_PARTITION in
// electron/main/utils/webviewSecurity.ts — the main process pins it at
// will-attach-webview regardless, so this attribute is belt-and-suspenders.
const PARTITION = 'persist:command-browser'

// Toolbar annotation modes. Edit is NOT a toolbar mode — it's triggered by
// right-clicking a selection in the page (installEditContextMenuScript), with
// an in-guest "Opslaan" overlay that signals back over console-message.
type AnnotationMode = 'none' | 'comment' | 'draw'

/**
 * The built-in browser: a real Electron <webview> with back/forward/reload,
 * an address bar, and dev tools. Loads local HTML and localhost dev apps, and
 * — at the user's own risk — external URLs (guests are hardened in the main
 * process; see webviewSecurity.ts). Replaces the former sandboxed iframe.
 */
export function BrowserTab({ url, isActive, onUrlChange, filePath, projectId }: BrowserTabProps) {
  const webviewRef = useRef<CommandWebviewElement>(null)
  // Flips true on the guest's dom-ready. Webview methods throw synchronously if
  // called before attach, so timer-driven calls (live-reload) must check this.
  const readyRef = useRef(false)
  const [input, setInput] = useState(url)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)

  // Annotation state.
  const [mode, setMode] = useState<AnnotationMode>('none')
  const [status, setStatus] = useState<string | null>(null)
  // Let the console-message listener (registered once) call the latest handlers.
  const handleEditSaveRef = useRef<((payload: EditResult) => void) | null>(null)
  const handleCommentSendRef = useRef<((payload: CommentPayload) => void) | null>(null)
  const handleMarkupAddRef = useRef<(() => void) | null>(null)
  const handleMarkupCancelRef = useRef<(() => void) | null>(null)

  // Keep the address bar in sync when the url changes outside this component.
  useEffect(() => {
    setInput(url)
  }, [url])

  // Reflect the guest's navigation state, (re)install the right-click edit flow
  // on each fresh document, and listen for the in-guest "save" signal.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onReady = () => {
      readyRef.current = true
      // The guest DOM resets on every navigation, so re-install each dom-ready.
      void execInGuest(wv, true, installEditContextMenuScript())
    }
    const sync = () => {
      setInput(wv.getURL())
      setCanBack(wv.canGoBack())
      setCanForward(wv.canGoForward())
    }
    // A full navigation resets the guest DOM, so any injected highlight/canvas
    // is gone — drop back to no active annotation to avoid stale references.
    const resetAnnotation = () => {
      setMode('none')
      setStatus(null)
    }
    const onConsole = (e: Event) => {
      const message = (e as unknown as { message?: string }).message
      const edit = parseEditSaveMessage(message)
      if (edit) {
        void handleEditSaveRef.current?.(edit)
        return
      }
      const comment = parseCommentMessage(message)
      if (comment) {
        handleCommentSendRef.current?.(comment)
        return
      }
      const markup = parseMarkupMessage(message)
      if (markup === 'add') void handleMarkupAddRef.current?.()
      else if (markup === 'cancel') void handleMarkupCancelRef.current?.()
    }
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-navigate', sync)
    wv.addEventListener('did-navigate', resetAnnotation)
    wv.addEventListener('did-navigate-in-page', sync)
    wv.addEventListener('console-message', onConsole)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-navigate', sync)
      wv.removeEventListener('did-navigate', resetAnnotation)
      wv.removeEventListener('did-navigate-in-page', sync)
      wv.removeEventListener('console-message', onConsole)
    }
  }, [])

  // Live-reload: when the backing file changes on disk (Claude regenerates it,
  // or the user saves via "Open as code"), reload the webview. Reuses the
  // existing per-project file-watch stream — no new watcher. Debounced so a
  // burst of writes coalesces into one reload.
  useEffect(() => {
    if (!filePath || !projectId) return
    const normalized = normalizeFilePath(filePath)
    const key = `browser-live-reload-${filePath}`
    let timer: ReturnType<typeof setTimeout> | null = null
    const handle = (events: FileWatchEvent[]) => {
      const changed = events.some((e) => e.type === 'file-changed' && e.path === normalized)
      if (!changed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        // Skip if the guest isn't attached yet — reload() throws synchronously
        // before dom-ready, which off a timer would be an uncaught exception.
        // The initial src load already shows current content, so skipping is safe.
        if (readyRef.current) webviewRef.current?.reload()
      }, RELOAD_DEBOUNCE_MS)
    }
    fileWatcherEvents.subscribe(projectId, key, handle)
    return () => {
      if (timer) clearTimeout(timer)
      fileWatcherEvents.unsubscribe(projectId, key)
    }
  }, [filePath, projectId])

  const navigate = () => {
    const next = normalizeAddressBarInput(input)
    if (!next) return
    setInput(next)
    if (next === url) {
      // Same string won't change the src prop; reload the guest directly.
      webviewRef.current?.loadURL(next).catch(() => {})
    } else {
      onUrlChange(next)
    }
  }

  // ---- Annotation helpers (host-pull) -------------------------------------

  const runGuest = (code: string) => execInGuest(webviewRef.current, readyRef.current, code)

  // Route text to the active Claude chat; false + a status hint when there
  // isn't one, so the user knows to focus a chat first (R3).
  const sendText = (text: string): boolean => {
    const result = sendAnnotationToChat(
      text,
      useProjectStore.getState(),
      getElectronAPI().terminal.write
    )
    if (!result.ok) {
      setStatus('Geen actieve Claude-chat — focus eerst een chat.')
      return false
    }
    return true
  }

  const switchMode = async (next: AnnotationMode) => {
    await runGuest(clearAnnotationsScript())
    setStatus(null)
    const target = mode === next ? 'none' : next
    setMode(target)
    if (target === 'comment') await runGuest(enableCommentInspectScript())
    else if (target === 'draw') await runGuest(enableMarkupScript())
  }

  // Fired from an in-guest comment box (right-click Comment, or inspect click).
  const handleCommentSend = (payload: CommentPayload) => {
    if (sendText(buildCommentMessage(payload))) {
      setStatus('Opmerking naar chat gestuurd.')
    }
  }

  // Apply an inline edit straight to a local file (no agent). Reports the exact
  // outcome so the caller can surface why it fell back to the agent.
  const tryDirectFileEdit = async (
    localPath: string,
    payload: EditResult
  ): Promise<'ok' | 'not-found' | 'ambiguous' | 'io-error'> => {
    let content: string
    try {
      content = await getElectronAPI().fs.readFile(localPath)
    } catch {
      return 'io-error'
    }
    // 1. Structural DOM-match (parse5): splice only the element's source range,
    //    leaving the rest of the file byte-for-byte intact.
    let result = applyDomEdit(content, payload.indexPath, payload.tag, payload.html)
    // 2. Fallback: text diff-span, in case the live DOM drifted from the source.
    if (!result.ok) result = applyDirectEdit(content, payload.before, payload.after)
    if (!result.ok) return result.reason
    try {
      await getElectronAPI().fs.writeFile(localPath, result.content)
      return 'ok'
    } catch {
      return 'io-error'
    }
  }

  // Fired from the in-guest "Opslaan" button via console-message. A local .html
  // page maps straight to its file, so apply the edit directly; dev-server
  // pages and ambiguous/absent matches fall back to the agent, with the reason
  // shown in the status line for diagnosis.
  const handleEditSave = async (payload: EditResult) => {
    if (payload.before === payload.after) {
      setStatus('Geen wijziging.')
      void runGuest(clearAnnotationsScript())
      return
    }
    const localPath = fileUrlToLocalPath(payload.url)
    if (localPath) {
      const outcome = await tryDirectFileEdit(localPath, payload)
      if (outcome === 'ok') {
        setStatus('Direct in het bestand aangepast.')
        void runGuest(clearAnnotationsScript())
        if (readyRef.current) webviewRef.current?.reload()
        return
      }
      const why =
        outcome === 'not-found'
          ? 'element/tekst niet teruggevonden'
          : outcome === 'ambiguous'
            ? 'niet eenduidig'
            : 'bestand lezen/schrijven mislukt'
      if (sendText(buildEditMessage(payload))) {
        setStatus(`Direct niet gelukt (${why}) — via de chat.`)
      }
      void runGuest(clearAnnotationsScript())
      return
    }
    // Non-file page (localhost dev-server): only the agent can find the source.
    if (sendText(buildEditMessage(payload))) {
      setStatus('Dev-server pagina — via de chat.')
    }
    void runGuest(clearAnnotationsScript())
  }
  // Fired from the floating markup toolbar's "Add to chat" (via console-message).
  // The toolbar has already hidden itself, so capturePage grabs page + markup
  // without the chrome; then re-show the toolbar and clear for the next markup.
  const handleMarkupAdd = async () => {
    const image = await captureGuest(webviewRef.current, readyRef.current)
    if (!image) {
      setStatus('Kon geen screenshot maken.')
      void runGuest(resetMarkupScript())
      return
    }
    getElectronAPI().clipboard.writeImage(image.toDataURL())
    const pageUrl = webviewRef.current?.getURL() ?? ''
    if (sendText(buildDrawMessage({ url: pageUrl }))) {
      setStatus('Screenshot op klembord — plak met Alt+V in de chat.')
    }
    void runGuest(resetMarkupScript())
  }

  // Fired from the markup toolbar's "Cancel".
  const handleMarkupCancel = () => {
    void runGuest(clearAnnotationsScript())
    setMode('none')
    setStatus(null)
  }

  // Keep the refs pointing at the latest handlers for the console-message listener.
  useEffect(() => {
    handleEditSaveRef.current = handleEditSave
    handleCommentSendRef.current = handleCommentSend
    handleMarkupAddRef.current = handleMarkupAdd
    handleMarkupCancelRef.current = handleMarkupCancel
  })

  const iconBtn =
    'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground'
  const modeBtn = (active: boolean) => `${iconBtn} ${active ? 'text-primary bg-muted/60' : ''}`

  return (
    <div
      className="absolute inset-0 flex flex-col bg-background"
      style={{ visibility: isActive ? 'visible' : 'hidden' }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-sidebar-accent">
        <button
          onClick={() => webviewRef.current?.goBack()}
          disabled={!canBack}
          title="Back"
          className={iconBtn}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          disabled={!canForward}
          title="Forward"
          className={iconBtn}
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => webviewRef.current?.reload()} title="Reload" className={iconBtn}>
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate()
          }}
          placeholder="localhost:5173 of pad naar een .html-bestand"
          className="flex-1 px-2 py-1 text-xs rounded bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={navigate} title="Go" className={iconBtn}>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => webviewRef.current?.openDevTools()}
          title="DevTools"
          className={iconBtn}
        >
          <Wrench className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          onClick={() => void switchMode('comment')}
          title="Annotatie: hover + klik een element om te becommentariëren"
          className={modeBtn(mode === 'comment')}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => void switchMode('draw')}
          title="Annotatie: tekenen"
          className={modeBtn(mode === 'draw')}
        >
          <Highlighter className="w-3.5 h-3.5" />
        </button>
      </div>

      {status && (
        <div className="flex items-center px-2 py-1.5 border-b border-border bg-sidebar-accent text-xs">
          <span className="text-muted-foreground truncate">{status}</span>
        </div>
      )}

      <webview
        ref={webviewRef}
        src={url}
        partition={PARTITION}
        className="flex-1 w-full bg-white"
        style={{ border: 0, display: 'inline-flex' }}
      />
    </div>
  )
}
