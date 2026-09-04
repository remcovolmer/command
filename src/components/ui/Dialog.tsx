import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { btnIcon } from './controls'

const SIZES = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-[900px]',
} as const

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** Header icon component (e.g. from lucide-react), rendered at 16px in primary. */
  icon?: React.ComponentType<{ className?: string }>
  size?: keyof typeof SIZES
  footer?: ReactNode
  children: ReactNode
  /** Extra classes for the body wrapper (e.g. to remove default padding). */
  bodyClassName?: string
}

/**
 * Shared dialog shell: backdrop + panel + header + scrollable body + optional
 * footer. Escape/Enter handling stays with the caller (useDialogHotkeys) —
 * this component only renders and wires the backdrop/close-button clicks.
 */
export function Dialog({
  open,
  onClose,
  title,
  icon: Icon,
  size = 'md',
  footer,
  children,
  bodyClassName,
}: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={onClose} />

      <div
        className={clsx(
          'relative w-full bg-popover rounded-xl border border-border shadow-[0_1px_2px_oklch(0_0_0/.06),0_12px_40px_-12px_oklch(0_0_0/.35)] flex flex-col max-h-[85vh]',
          'dialog-in',
          SIZES[size]
        )}
      >
        <div className="flex items-center gap-2 h-12 px-5 border-b border-border shrink-0">
          {Icon && <Icon className="w-4 h-4 text-primary shrink-0" />}
          <h2 className="text-[15px] font-semibold text-fg-strong truncate flex-1 min-w-0">
            {title}
          </h2>
          <button onClick={onClose} className={btnIcon} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={clsx('flex-1 min-h-0 overflow-y-auto px-5 py-4', bodyClassName)}>
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
