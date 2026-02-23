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

      const evicted = terminalPool.evict(candidate)
      if (evicted) {
        // Notify main process to start buffering PTY data
        api.terminal.evict(candidate)
      } else {
        break // serialization failed, stop trying
      }
    }
  }, [activeTerminalId, splitTerminalIds, api])
}
