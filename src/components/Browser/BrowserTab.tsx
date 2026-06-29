import { useEffect, useState } from 'react'
import { RotateCw, ArrowRight } from 'lucide-react'

interface BrowserTabProps {
  url: string
  isActive: boolean
  onUrlChange: (url: string) => void
}

/**
 * Iframe-based browser content tab. Loads local HTML files and the user's own
 * localhost dev app. External SaaS (Gmail/Outlook) is blocked by X-Frame-Options
 * and is out of scope; the panel is structured so a real webview can replace the
 * iframe later (see the requirements doc).
 */
export function BrowserTab({ url, isActive, onUrlChange }: BrowserTabProps) {
  const [input, setInput] = useState(url)
  const [reloadKey, setReloadKey] = useState(0)

  // Keep the address bar in sync when the url changes outside this component.
  useEffect(() => {
    setInput(url)
  }, [url])

  const navigate = () => {
    let next = input.trim()
    if (!next) return
    if (!/^https?:\/\//i.test(next) && !next.startsWith('file://')) {
      next = `http://${next}`
    }
    if (next === url) {
      setReloadKey((k) => k + 1)
    } else {
      onUrlChange(next)
    }
    setInput(next)
  }

  return (
    <div
      className="absolute inset-0 flex flex-col bg-background"
      style={{ visibility: isActive ? 'visible' : 'hidden' }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-sidebar-accent">
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="Reload"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
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
        <button
          onClick={navigate}
          title="Go"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <iframe
        key={reloadKey}
        src={url}
        title="Browser"
        className="flex-1 w-full border-0 bg-white"
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
      />
    </div>
  )
}
