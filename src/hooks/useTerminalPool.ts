import { useEffect, useRef } from 'react'
import { terminalPool } from '../utils/terminalPool'
import { getElectronAPI } from '../utils/electron'
import type { TerminalSession } from '../types'

/**
 * Hook that manages the terminal LRU pool eviction lifecycle.
 * Call this once per project viewport. It watches for terminal switches
 * and triggers eviction when the pool exceeds its max size.
 *
 * Terminal removal from pool is handled by useXtermInstance on unmount.
 */
export function useTerminalPool(
  terminals: Record<string, TerminalSession>,
  activeTerminalId: string | null,
  splitTerminalIds: string[]
) {
  const apiRef = useRef(getElectronAPI())

  // When active terminal changes, check if eviction is needed
  useEffect(() => {
    if (!activeTerminalId) return

    // Touch the newly active terminal (already done in useXtermInstance too,
    // but this covers the case where we need to evict before init fires)
    terminalPool.touch(activeTerminalId)

    // Check if pool needs eviction
    if (!terminalPool.needsEviction()) return

    const candidate = terminalPool.getEvictionCandidate(
      terminals,
      activeTerminalId,
      splitTerminalIds
    )

    if (candidate) {
      terminalPool.evict(candidate, apiRef.current)
    }
  }, [activeTerminalId, terminals, splitTerminalIds])
}
