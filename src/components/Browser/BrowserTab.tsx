import { useEffect, useRef, useState } from 'react'
import {
  RotateCw,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  Wrench,
  MessageSquare,
  PencilLine,
  Highlighter,
  Send,
} from 'lucide-react'
import { normalizeAddressBarInput } from '../../utils/browserUrls'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath } from '../../utils/paths'
import { getElectronAPI } from '../../utils/electron'
import { useProjectStore } from '../../stores/projectStore'
import { execInGuest, captureGuest } from '../../utils/webviewControl'
import {
  readSelectionScript,
  startEditScript,
  readEditScript,
  enableDrawScript,
  clearAnnotationsScript,
  isSelectionResult,
  isEditStartResult,
  isEditResult,
} from '../../utils/annotationGuestScript'
import {
  buildCommentMessage,
  buildEditMessage,
  buildDrawMessage,
  sendAnnotationToChat,
} from '../../utils/annotationMessage'
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

// Annotation modes layered on the webview. Each drives the guest via host-pull
// (executeJavaScript / capturePage) and routes the result to the active Claude
// chat; the primary UI lives here in React, not injected into the guest.
type AnnotationMode = 'none' | 'comment' | 'edit' | 'draw'

interface PendingComment {
  url: string
  selector: string
  snippet: string
}

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
  const [pendingComment, setPendingComment] = useState<PendingComment | null>(null)
  const [commentText, setCommentText] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  // Keep the address bar in sync when the url changes outside this component.
  useEffect(() => {
    setInput(url)
  }, [url])

  // Reflect the guest's real navigation state into the address bar and buttons.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onReady = () => {
      readyRef.current = true
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
      setPendingComment(null)
      setStatus(null)
    }
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-navigate', sync)
    wv.addEventListener('did-navigate', resetAnnotation)
    wv.addEventListener('did-navigate-in-page', sync)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-navigate', sync)
      wv.removeEventListener('did-navigate', resetAnnotation)
      wv.removeEventListener('did-navigate-in-page', sync)
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
    setPendingComment(null)
    setCommentText('')
    setStatus(null)
    const target = mode === next ? 'none' : next
    setMode(target)
    if (target === 'draw') await runGuest(enableDrawScript())
  }

  const captureSelection = async () => {
    const res = await runGuest(readSelectionScript())
    if (!isSelectionResult(res) || !res.text) {
      setStatus('Niets geselecteerd op de pagina.')
      return
    }
    setPendingComment({ url: res.url, selector: res.selector, snippet: res.outerHTML })
    setStatus(null)
  }

  const sendComment = () => {
    if (!pendingComment || !commentText.trim()) return
    const msg = buildCommentMessage({ ...pendingComment, comment: commentText.trim() })
    if (sendText(msg)) {
      setPendingComment(null)
      setCommentText('')
      void runGuest(clearAnnotationsScript())
      setStatus('Naar chat gestuurd.')
    }
  }

  const startEdit = async () => {
    const res = await runGuest(startEditScript())
    if (!isEditStartResult(res)) {
      setStatus('Selecteer eerst tekst om te bewerken.')
      return
    }
    setStatus('Bewerk de tekst op de pagina, klik dan "Stuur edit".')
  }

  const sendEdit = async () => {
    const res = await runGuest(readEditScript())
    if (!isEditResult(res)) {
      setStatus('Geen actieve edit — klik eerst "Start edit".')
      return
    }
    if (res.before === res.after) {
      setStatus('Geen wijziging gevonden.')
      void runGuest(clearAnnotationsScript())
      return
    }
    if (sendText(buildEditMessage(res))) {
      setStatus('Edit naar chat gestuurd.')
      void runGuest(clearAnnotationsScript())
    }
  }

  const addDrawingToChat = async () => {
    const image = await captureGuest(webviewRef.current, readyRef.current)
    if (!image) {
      setStatus('Kon geen screenshot maken.')
      return
    }
    getElectronAPI().clipboard.writeImage(image.toDataURL())
    const pageUrl = webviewRef.current?.getURL() ?? ''
    if (sendText(buildDrawMessage({ url: pageUrl }))) {
      setStatus('Screenshot op klembord — plak met Alt+V in de chat.')
      // Reset the canvas so the user can immediately mark up the next thing.
      await runGuest(clearAnnotationsScript())
      await runGuest(enableDrawScript())
    }
  }

  const iconBtn =
    'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground'
  const modeBtn = (active: boolean) => `${iconBtn} ${active ? 'text-primary bg-muted/60' : ''}`
  const annotBtn =
    'inline-flex items-center gap-1 px-2 py-1 rounded text-foreground border border-border hover:bg-muted/50'

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
          title="Annotatie: selecteer + commentaar"
          className={modeBtn(mode === 'comment')}
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => void switchMode('edit')}
          title="Annotatie: inline editen"
          className={modeBtn(mode === 'edit')}
        >
          <PencilLine className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => void switchMode('draw')}
          title="Annotatie: tekenen"
          className={modeBtn(mode === 'draw')}
        >
          <Highlighter className="w-3.5 h-3.5" />
        </button>
      </div>

      {mode !== 'none' && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-sidebar-accent text-xs">
          {mode === 'comment' &&
            (!pendingComment ? (
              <button onClick={() => void captureSelection()} className={annotBtn}>
                Lees selectie
              </button>
            ) : (
              <>
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendComment()
                  }}
                  autoFocus
                  placeholder="Opmerking…"
                  className="flex-1 px-2 py-1 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button onClick={sendComment} className={annotBtn}>
                  <Send className="w-3 h-3" /> Stuur
                </button>
              </>
            ))}
          {mode === 'edit' && (
            <>
              <button onClick={() => void startEdit()} className={annotBtn}>
                Start edit
              </button>
              <button onClick={() => void sendEdit()} className={annotBtn}>
                <Send className="w-3 h-3" /> Stuur edit
              </button>
            </>
          )}
          {mode === 'draw' && (
            <>
              <span className="text-muted-foreground">Teken op de pagina.</span>
              <button onClick={() => void addDrawingToChat()} className={annotBtn}>
                <Send className="w-3 h-3" /> Voeg toe aan chat
              </button>
              <button onClick={() => void runGuest(clearAnnotationsScript())} className={annotBtn}>
                Wis
              </button>
            </>
          )}
          {status && <span className="ml-auto text-muted-foreground truncate">{status}</span>}
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
