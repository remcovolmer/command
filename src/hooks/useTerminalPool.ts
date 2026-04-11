import { useEffect, useMemo } from 'react'
import { terminalPool } from '../utils/terminalPool'
import { getElectronAPI } from '../utils/electron'
import { useProjectStore } from '../stores/projectStore'

/**
 * Hook that manages the terminal LRU pool eviction lifecycle.
 * Call this once per project viewport. It watches for terminal switches
 * and triggers eviction when the pool exceeds its max size.
 *
 * Terminal removal from pool is handled by useXtermInstance on unmount.
 */
export function useTerminalPool(
  activeTerminalId: string | null,
  splitTerminalIds: string[]
) {
  const api = useMemo(() => getElectronAPI(), [])

  // When active terminal changes, check if eviction is needed
  useEffect(() => {
    if (!activeTerminalId) return

    // Touch the newly active terminal (already done in useXtermInstance too,
    // but this covers the case where we need to evict before init fires)
    terminalPool.touch(activeTerminalId)

    // Evict all excess terminals at once (not one per switch)
    let evictionGuard = 0
    while (terminalPool.needsEviction() && evictionGuard++ < 20) {
      // Read current terminals from store each iteration (state may change during eviction)
      const terminals = useProjectStore.getState().terminals
      const candidate = terminalPool.getEvictionCandidate(
        terminals,
        activeTerminalId,
        splitTerminalIds
      )

      if (!candidate) break

      // Notify main process to start buffering PTY data BEFORE destroying
      // the renderer-side xterm instance. Otherwise there is a race window
      // between unsubscribing from terminal:data events (inside evict()) and
      // the main process receiving the evict IPC — data arriving in that
      // window would be forwarded to a missing subscriber and lost.
      api.terminal.evict(candidate)

      const evicted = terminalPool.evict(candidate)
      if (!evicted) {
        // Serialization failed — tell main to stop buffering and resume forwarding
        api.terminal.restore(candidate)
        break
      }
    }
  }, [activeTerminalId, splitTerminalIds, api])
}
