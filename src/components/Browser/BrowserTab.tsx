import { useEffect, useRef, useState } from 'react'
import { RotateCw, ArrowRight, ArrowLeft, ChevronRight, Wrench } from 'lucide-react'
import { normalizeAddressBarInput } from '../../utils/browserUrls'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath } from '../../utils/paths'
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
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-navigate', sync)
    wv.addEventListener('did-navigate-in-page', sync)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-navigate', sync)
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

  const iconBtn =
    'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground'

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
      </div>
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
