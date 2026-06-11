import { useEffect, useRef, useState, useCallback } from 'react'
import { getElectronAPI } from '../../utils/electron'
import { pushToastDismiss } from '../../utils/toastRegistry'
import type { UncaughtErrorEvent } from '../../types'

interface ToastItem {
  id: number
  message: string
  logPath: string
}

const AUTO_DISMISS_MS = 8000
const MAX_VISIBLE_TOASTS = 5

export function UncaughtErrorToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Counter survives remounts so newly-created toast IDs cannot collide with
  // the IDs of toasts already on screen.
  const nextIdRef = useRef(0)
  // Track pending auto-dismiss timeouts so they can be cleared on unmount —
  // otherwise they fire on a stale setToasts after the component is gone.
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const registryUnsubsRef = useRef<Map<number, () => void>>(new Map())

  const dismiss = useCallback((id: number) => {
    const handle = timeoutsRef.current.get(id)
    if (handle !== undefined) {
      clearTimeout(handle)
      timeoutsRef.current.delete(id)
    }
    const unsub = registryUnsubsRef.current.get(id)
    if (unsub) {
      unsub()
      registryUnsubsRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const scheduleDismiss = useCallback(
    (id: number) => {
      const existing = timeoutsRef.current.get(id)
      if (existing !== undefined) clearTimeout(existing)
      const handle = setTimeout(() => {
        timeoutsRef.current.delete(id)
        dismiss(id)
      }, AUTO_DISMISS_MS)
      timeoutsRef.current.set(id, handle)
    },
    [dismiss]
  )

  useEffect(() => {
    const api = getElectronAPI()
    const onUncaughtError = api?.app?.onUncaughtError
    if (!onUncaughtError) return

    const unsub = onUncaughtError((event: UncaughtErrorEvent) => {
      setToasts((prev) => {
        const id = ++nextIdRef.current
        scheduleDismiss(id)
        registryUnsubsRef.current.set(
          id,
          pushToastDismiss(() => dismiss(id))
        )
        // Cap visible count: drop the oldest when over the limit. Dedup by
        // message is skipped intentionally — uncaught errors from different
        // sites can share a generic message (e.g. "TypeError") but represent
        // distinct bugs we still want to surface individually.
        const next = [...prev, { id, message: event.message, logPath: event.logPath }]
        if (next.length > MAX_VISIBLE_TOASTS) {
          const dropped = next.slice(0, next.length - MAX_VISIBLE_TOASTS)
          for (const t of dropped) {
            const h = timeoutsRef.current.get(t.id)
            if (h !== undefined) {
              clearTimeout(h)
              timeoutsRef.current.delete(t.id)
            }
            const u = registryUnsubsRef.current.get(t.id)
            if (u) {
              u()
              registryUnsubsRef.current.delete(t.id)
            }
          }
          return next.slice(-MAX_VISIBLE_TOASTS)
        }
        return next
      })
    })

    const timeouts = timeoutsRef.current
    const registryUnsubs = registryUnsubsRef.current
    return () => {
      unsub()
      for (const handle of timeouts.values()) clearTimeout(handle)
      timeouts.clear()
      for (const u of registryUnsubs.values()) u()
      registryUnsubs.clear()
    }
  }, [scheduleDismiss, dismiss])

  const openLog = useCallback(async () => {
    const api = getElectronAPI()
    await api?.app?.openCrashLog?.()
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 overflow-y-auto max-h-[60vh]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="bg-amber-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm"
        >
          <div className="flex items-start gap-3">
            <div className="text-amber-300 mt-0.5">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">An internal error occurred</p>
              <p className="text-sm text-amber-200 mt-1 break-all">{toast.message}</p>
              <button
                onClick={openLog}
                className="mt-3 px-3 py-1.5 bg-amber-800 hover:bg-amber-700 rounded text-sm font-medium transition-colors"
              >
                Open crash.log
              </button>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-amber-300 hover:text-white"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
