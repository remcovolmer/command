import { useEffect, useRef, useState } from 'react'
import {
  MoreHorizontal,
  ZoomIn,
  Search,
  RefreshCw,
  ExternalLink,
  Copy,
  Minus,
  Plus,
} from 'lucide-react'

interface BrowserOverflowMenuProps {
  zoomLabel: string
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFind: () => void
  onHardReload: () => void
  onOpenExternal: () => void
  onCopyUrl: () => void
}

const iconBtn =
  'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40'

/**
 * The browser toolbar's "⋯" overflow menu. Houses the new QoL controls (zoom,
 * find, hard reload, open-in-system, copy URL) so the toolbar itself stays
 * uncluttered. Menu items are host chrome — they work regardless of whether the
 * webview has focus, unlike keyboard shortcuts (see the main-process handler).
 */
export function BrowserOverflowMenu(props: BrowserOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Zoom steppers keep the menu open (you tune, then move on); the one-shot
  // actions close it.
  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }
  const step = (fn: () => void) => () => fn()

  const item =
    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 text-left'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Meer — zoom, zoeken, hard reload, systeembrowser"
        className={`${iconBtn} ${open ? 'text-primary bg-muted/60' : ''}`}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[224px] rounded-md border border-border bg-background shadow-lg py-1">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-foreground">
            <span className="flex items-center gap-2">
              <ZoomIn className="w-3.5 h-3.5" /> Zoom
            </span>
            <span className="flex items-center gap-1">
              <button onClick={step(props.onZoomOut)} title="Uitzoomen" className={iconBtn}>
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={step(props.onZoomReset)}
                title="Reset naar 100%"
                className="min-w-[42px] text-center tabular-nums text-muted-foreground hover:text-foreground"
              >
                {props.zoomLabel}
              </button>
              <button onClick={step(props.onZoomIn)} title="Inzoomen" className={iconBtn}>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>
          <div className="my-1 h-px bg-border" />
          <button onClick={act(props.onFind)} className={item}>
            <Search className="w-3.5 h-3.5" /> Zoeken op pagina
            <span className="ml-auto text-muted-foreground">Ctrl+F</span>
          </button>
          <button onClick={act(props.onHardReload)} className={item}>
            <RefreshCw className="w-3.5 h-3.5" /> Hard reload
            <span className="ml-auto text-muted-foreground">Ctrl+Shift+R</span>
          </button>
          <div className="my-1 h-px bg-border" />
          <button onClick={act(props.onOpenExternal)} className={item}>
            <ExternalLink className="w-3.5 h-3.5" /> Open in systeembrowser
          </button>
          <button onClick={act(props.onCopyUrl)} className={item}>
            <Copy className="w-3.5 h-3.5" /> URL kopiëren
          </button>
        </div>
      )}
    </div>
  )
}
