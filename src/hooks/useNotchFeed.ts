import { useEffect, useRef } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import { deriveNotchSessions } from '../utils/notchFeed'

/**
 * Push the cross-project agent-session snapshot to the main process (which
 * relays it to the strip window) whenever the store changes. Dedupes on the
 * serialized payload so unrelated store updates don't spam IPC. Mount once
 * from the app root.
 */
export function useNotchFeed(): void {
  const lastRef = useRef<string>('')
  useEffect(() => {
    const api = getElectronAPI()
    const push = () => {
      const { terminals, projects } = useProjectStore.getState()
      const payload = { sessions: deriveNotchSessions(terminals, projects) }
      const serialized = JSON.stringify(payload)
      if (serialized === lastRef.current) return
      lastRef.current = serialized
      api.notch.pushUpdate(payload)
    }
    push()
    return useProjectStore.subscribe(push)
  }, [])
}
