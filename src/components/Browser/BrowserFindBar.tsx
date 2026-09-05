import { useEffect, useRef } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { btnIcon } from '../ui/controls'

interface BrowserFindBarProps {
  value: string
  activeMatch: number
  totalMatches: number
  onChange: (text: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

const iconBtn = `${btnIcon} w-6 h-6`

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
    <div className="absolute top-2 right-3 z-40 flex items-center gap-1 rounded-lg border border-border bg-popover shadow-[0_8px_30px_-10px_oklch(0_0_0/.35)] px-2 py-1">
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
        className="w-48 px-1 py-0.5 text-[12.5px] bg-transparent text-fg placeholder:text-fg-faint focus:outline-none"
      />
      <span className="font-mono text-[11px] text-fg-muted tnum min-w-[46px] text-center">
        {value ? `${activeMatch} / ${totalMatches}` : ''}
      </span>
      <button
        onClick={onPrev}
        disabled={totalMatches === 0}
        title="Vorige (Shift+Enter)"
        className={iconBtn}
      >
        <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
      <button
        onClick={onNext}
        disabled={totalMatches === 0}
        title="Volgende (Enter)"
        className={iconBtn}
      >
        <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
      <button onClick={onClose} title="Sluiten (Esc)" className={iconBtn}>
        <X className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
    </div>
  )
}
