import { AlertTriangle, RotateCw } from 'lucide-react'
import { btnSecondary } from '../ui/controls'

interface BrowserErrorStateProps {
  url: string
  reason: string
  onRetry: () => void
}

/**
 * In-app overlay shown over the webview when a main-frame load fails. Replaces
 * the raw Chromium error page with the failed URL, a human-readable reason, and
 * a Retry. Generic across all load failures — the localhost "dev-server not
 * running" case is just one of them.
 */
export function BrowserErrorState({ url, reason, onRetry }: BrowserErrorStateProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-screen px-6 text-center">
      <AlertTriangle className="w-8 h-8 text-fg-faint" strokeWidth={1.5} />
      <div className="text-[15px] font-semibold text-fg-strong">Kon de pagina niet laden</div>
      <div className="max-w-md text-[12.5px] text-fg-muted">{reason}</div>
      <div className="max-w-md break-all font-mono text-[11px] text-fg-faint">{url}</div>
      <button onClick={onRetry} className={`${btnSecondary} mt-1`}>
        <RotateCw className="w-3.5 h-3.5" strokeWidth={1.5} /> Opnieuw proberen
      </button>
    </div>
  )
}
