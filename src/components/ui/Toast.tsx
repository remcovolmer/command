import type { ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { btnIcon } from './controls'

export type ToastTone = 'danger' | 'warning' | 'info' | 'success'

const RAIL: Record<ToastTone, string> = {
  danger: 'border-l-danger',
  warning: 'border-l-warning',
  info: 'border-l-info',
  success: 'border-l-success',
}

const ICON: Record<ToastTone, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
  success: 'text-success',
}

interface ToastProps {
  tone: ToastTone
  icon: LucideIcon
  title: string
  onDismiss?: () => void
  /** Wrapper when the toast is rendered standalone (not inside a stack). */
  fixed?: boolean
  children?: ReactNode
}

/**
 * Neutral toast card: popover surface with a 3px semantic rail on the left and
 * the icon in the same tone. Replaces the solid colored alert blocks so a toast
 * reads as part of the app instead of a foreign banner.
 */
export function Toast({ tone, icon: Icon, title, onDismiss, fixed, children }: ToastProps) {
  return (
    <div
      role="status"
      className={clsx(
        'w-[360px] max-w-[calc(100vw-2rem)] bg-popover border border-border border-l-[3px] rounded-lg p-3',
        'shadow-[0_1px_2px_oklch(0_0_0/.06),0_8px_30px_-10px_oklch(0_0_0/.35)]',
        RAIL[tone],
        fixed && 'fixed bottom-4 right-4 z-50'
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', ICON[tone])} strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-fg-strong">{title}</p>
          {children}
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className={clsx(btnIcon, '-mr-1 -mt-1')} aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
