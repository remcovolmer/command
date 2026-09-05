import { useEffect, useRef, useState, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import { Toast } from '../ui/Toast'
import { btnSecondary } from '../ui/controls'
import { terminalEvents } from '../../utils/terminalEvents'
import { pushToastDismiss } from '../../utils/toastRegistry'
import type { SpawnFailureCode } from '../../types'

interface ToastItem {
  id: number
  code: SpawnFailureCode
  cwd: string
  message: string
}

const AUTO_DISMISS_MS = 8000
const MAX_VISIBLE_TOASTS = 5

function describeSpawnError(code: SpawnFailureCode, cwd: string): { title: string; body: string } {
  switch (code) {
    case 'CWD_MISSING':
      return {
        title: 'Working directory not found',
        body: `${cwd} no longer exists. Remove the project or update its path.`,
      }
    case 'CWD_NOT_DIR':
      return {
        title: 'Working directory invalid',
        body: `${cwd} is not a directory.`,
      }
    case 'SPAWN_FAILED':
      return {
        title: 'Failed to start shell',
        body: `Could not start a shell in ${cwd}. See crash.log for details.`,
      }
  }
}

export function SpawnErrorToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Counter survives remounts so newly-created toast IDs cannot collide with
  // the IDs of toasts already on screen.
  const nextIdRef = useRef(0)
  // Track pending auto-dismiss timeouts so they can be cleared on unmount —
  // otherwise they fire on a stale setToasts after the component is gone.
  // Keyed by toast id so dedup can refresh an existing timer without leaking
  // the old one.
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  // Registered dismiss handles per toast id, so Escape can dismiss the
  // topmost via the global toast registry.
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
      // Clear any prior timer for this id so dedup can refresh cleanly.
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
    const unsub = terminalEvents.onSpawnFailed((event) => {
      setToasts((prev) => {
        // Dedup: if a toast with the same (code, cwd) is already on screen,
        // refresh its dismiss timer instead of stacking duplicates.
        const existing = prev.find((t) => t.code === event.code && t.cwd === event.cwd)
        if (existing) {
          scheduleDismiss(existing.id)
          return prev
        }
        const id = ++nextIdRef.current
        scheduleDismiss(id)
        registryUnsubsRef.current.set(
          id,
          pushToastDismiss(() => dismiss(id))
        )
        // Cap visible count: drop the oldest when over the limit so a flood of
        // spawn failures doesn't bury the whole UI under toasts.
        const next = [...prev, { id, code: event.code, cwd: event.cwd, message: event.message }]
        if (next.length > MAX_VISIBLE_TOASTS) {
          const dropped = next.slice(0, next.length - MAX_VISIBLE_TOASTS)
          for (const t of dropped) {
            const h = timeoutsRef.current.get(t.id)
            if (h !== undefined) {
              clearTimeout(h)
              timeoutsRef.current.delete(t.id)
            }
            const unsub = registryUnsubsRef.current.get(t.id)
            if (unsub) {
              unsub()
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
      {toasts.map((toast) => {
        const { title, body } = describeSpawnError(toast.code, toast.cwd)
        return (
          <Toast
            key={toast.id}
            tone="danger"
            icon={AlertCircle}
            title={title}
            onDismiss={() => dismiss(toast.id)}
          >
            <p className="text-[12.5px] text-fg-muted mt-0.5 break-all">{body}</p>
            {toast.code === 'SPAWN_FAILED' && (
              <button onClick={openLog} className={`${btnSecondary} h-7 px-2.5 text-[12.5px] mt-3`}>
                Open crash.log
              </button>
            )}
          </Toast>
        )
      })}
    </div>
  )
}
