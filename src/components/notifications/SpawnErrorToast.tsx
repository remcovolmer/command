import { useEffect, useState, useCallback } from 'react'
import { getElectronAPI } from '../../utils/electron'
import type { SpawnFailedEvent, SpawnFailureCode, UncaughtErrorEvent } from '../../types'

type ToastKind = 'spawn' | 'uncaught'

interface ToastItem {
  id: number
  kind: ToastKind
  code?: SpawnFailureCode
  cwd?: string
  message: string
  logPath?: string
}

const AUTO_DISMISS_MS = 8000

function describeSpawnError(code: SpawnFailureCode, cwd: string): { title: string; body: string } {
  switch (code) {
    case 'CWD_MISSING':
      return {
        title: 'Working directory not found',
        body: `${cwd} bestaat niet meer. Verwijder het project of pas het pad aan.`,
      }
    case 'CWD_NOT_DIR':
      return {
        title: 'Working directory invalid',
        body: `${cwd} is geen directory.`,
      }
    case 'SPAWN_FAILED':
      return {
        title: 'Failed to start shell',
        body: `Kon geen shell starten in ${cwd}. Zie crash.log voor details.`,
      }
  }
}

export function SpawnErrorToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    const api = getElectronAPI()
    if (!api?.terminal?.onSpawnFailed || !api?.app?.onUncaughtError) return

    let nextId = 1

    const unsubSpawn = api.terminal.onSpawnFailed((event: SpawnFailedEvent) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, kind: 'spawn', code: event.code, cwd: event.cwd, message: event.message }])
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    })

    const unsubUncaught = api.app.onUncaughtError((event: UncaughtErrorEvent) => {
      const id = nextId++
      setToasts((prev) => [
        ...prev,
        { id, kind: 'uncaught', message: event.message, logPath: event.logPath },
      ])
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    })

    return () => {
      unsubSpawn()
      unsubUncaught()
    }
  }, [dismiss])

  const openLog = useCallback(async () => {
    const api = getElectronAPI()
    await api?.app?.openCrashLog?.()
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((toast) => {
        if (toast.kind === 'spawn' && toast.code && toast.cwd) {
          const { title, body } = describeSpawnError(toast.code, toast.cwd)
          return (
            <div
              key={toast.id}
              role="status"
              className="bg-red-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm"
            >
              <div className="flex items-start gap-3">
                <div className="text-red-400 mt-0.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-red-200 mt-1 break-all">{body}</p>
                  {toast.code === 'SPAWN_FAILED' && (
                    <button
                      onClick={openLog}
                      className="mt-3 px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-sm font-medium transition-colors"
                    >
                      Open crash.log
                    </button>
                  )}
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="text-red-300 hover:text-white"
                  aria-label="Dismiss"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )
        }

        // Uncaught exception toast — generic safety net surface
        return (
          <div
            key={toast.id}
            role="status"
            className="bg-amber-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm"
          >
            <div className="flex items-start gap-3">
              <div className="text-amber-300 mt-0.5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z" />
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
