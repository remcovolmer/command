import { AlertTriangle, RotateCw } from 'lucide-react'

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
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <AlertTriangle className="w-8 h-8 text-muted-foreground" />
      <div className="text-sm font-medium text-foreground">Kon de pagina niet laden</div>
      <div className="max-w-md text-xs text-muted-foreground">{reason}</div>
      <div className="max-w-md break-all font-mono text-xs text-muted-foreground/70">{url}</div>
      <button
        onClick={onRetry}
        className="mt-1 flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/50"
      >
        <RotateCw className="w-3.5 h-3.5" /> Opnieuw proberen
      </button>
    </div>
  )
}
