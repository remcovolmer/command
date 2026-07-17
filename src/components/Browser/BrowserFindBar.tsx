import { useEffect, useRef } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'

interface BrowserFindBarProps {
  value: string
  activeMatch: number
  totalMatches: number
  onChange: (text: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

const iconBtn =
  'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40'

/**
 * Find-in-page bar that floats over the top-right of the page. Enter /
 * Shift+Enter cycle matches, Esc closes. Auto-focuses on open.
 */
export function BrowserFindBar({
  value,
  activeMatch,
  totalMatches,
  onChange,
  onNext,
  onPrev,
  onClose,
}: BrowserFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="absolute top-2 right-3 z-40 flex items-center gap-1 rounded-md border border-border bg-background shadow-lg px-2 py-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder="Zoeken op pagina"
        className="w-48 px-1 py-0.5 text-xs bg-transparent text-foreground focus:outline-none"
      />
      <span className="text-xs text-muted-foreground tabular-nums min-w-[46px] text-center">
        {value ? `${activeMatch} / ${totalMatches}` : ''}
      </span>
      <button onClick={onPrev} disabled={totalMatches === 0} title="Vorige (Shift+Enter)" className={iconBtn}>
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button onClick={onNext} disabled={totalMatches === 0} title="Volgende (Enter)" className={iconBtn}>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button onClick={onClose} title="Sluiten (Esc)" className={iconBtn}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
