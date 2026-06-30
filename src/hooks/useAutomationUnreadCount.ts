import { useEffect, useMemo, useState } from 'react'
import { getElectronAPI } from '../utils/electron'
import type { AutomationRun } from '../types'

/**
 * Live count of unread automation runs, excluding runs that are still running.
 * Loads once on mount and recomputes whenever a run completes or fails.
 * Consumed by the activity rail to badge the Automations icon.
 */
export function useAutomationUnreadCount(): number {
  const api = useMemo(() => getElectronAPI(), [])
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const loadUnread = async () => {
      try {
        const runs = (await api.automation.listRuns(undefined, 100)) as AutomationRun[]
        const unread = runs.filter((r) => !r.read && r.status !== 'running').length
        if (!cancelled) setUnreadCount(unread)
      } catch {
        /* ignore — count stays at its last known value */
      }
    }
    loadUnread()

    const unsubCompleted = api.automation.onRunCompleted(() => loadUnread())
    const unsubFailed = api.automation.onRunFailed(() => loadUnread())
    return () => {
      cancelled = true
      unsubCompleted()
      unsubFailed()
    }
  }, [api])

  return unreadCount
}
