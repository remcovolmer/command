import type { TerminalSession, TerminalState } from '../types'

const MAX_SERIALIZED_SIZE = 2 * 1024 * 1024 // 2MB per terminal
// PTY output that reaches the renderer while a terminal has no live xterm
// (in flight at eviction, or before first open). Mirrors main's 1MB cap.
const MAX_PENDING_SIZE = 1024 * 1024

/** Keep the tail of `text` within `max` chars, cutting at a line boundary when possible. */
function trimFront(text: string, max: number): string {
  if (text.length <= max) return text
  const truncateAt = text.length - max
  const lineBreak = text.indexOf('\n', truncateAt)
  return lineBreak !== -1 ? text.slice(lineBreak + 1) : text.slice(truncateAt)
}

// Terminal states that are protected from eviction (require user attention)
const PROTECTED_STATES: Set<TerminalState> = new Set(['busy', 'permission', 'question'])

type SerializeFn = () => string | null
type CleanupFn = () => void

export class TerminalPool {
  private maxSize: number
  private lruOrder: string[] = [] // terminal IDs, most-recent first
  private serializedBuffers: Map<string, string> = new Map()
  private evictedSet: Set<string> = new Set()
  private pendingData: Map<string, string> = new Map()

  // Callback registry: each terminal registers its serializer and cleanup
  private serializers: Map<string, SerializeFn> = new Map()
  private cleanups: Map<string, CleanupFn> = new Map()

  constructor(maxSize: number = 5) {
    this.maxSize = Math.max(2, Math.min(20, maxSize))
  }

  /** Register serializer and cleanup for a terminal's xterm instance */
  registerCallbacks(terminalId: string, serialize: SerializeFn, cleanup: CleanupFn): void {
    this.serializers.set(terminalId, serialize)
    this.cleanups.set(terminalId, cleanup)
  }

  /** Unregister callbacks (called when terminal is closed or component unmounts) */
  unregisterCallbacks(terminalId: string): void {
    this.serializers.delete(terminalId)
    this.cleanups.delete(terminalId)
  }

  /** Move terminal to front of LRU (most recently used) */
  touch(terminalId: string): void {
    const idx = this.lruOrder.indexOf(terminalId)
    if (idx > 0) {
      this.lruOrder.splice(idx, 1)
      this.lruOrder.unshift(terminalId)
    } else if (idx === -1) {
      this.lruOrder.unshift(terminalId)
    }
  }

  /** Remove terminal from tracking entirely (on close) */
  remove(terminalId: string): void {
    const idx = this.lruOrder.indexOf(terminalId)
    if (idx !== -1) this.lruOrder.splice(idx, 1)
    this.serializedBuffers.delete(terminalId)
    this.pendingData.delete(terminalId)
    this.evictedSet.delete(terminalId)
    this.serializers.delete(terminalId)
    this.cleanups.delete(terminalId)
  }

  /** Check if a terminal is currently evicted */
  isEvicted(terminalId: string): boolean {
    return this.evictedSet.has(terminalId)
  }

  /** Mark terminal as restored (no longer evicted) */
  markRestored(terminalId: string): void {
    this.evictedSet.delete(terminalId)
  }

  /** Store serialized scrollback buffer for an evicted terminal */
  storeBuffer(terminalId: string, serialized: string): void {
    this.serializedBuffers.set(terminalId, trimFront(serialized, MAX_SERIALIZED_SIZE))
  }

  /**
   * Hold PTY output that arrived while the terminal had no live xterm. This
   * covers data main sent before it processed `terminal:evict` (IPC ordering
   * puts it before anything main buffers afterwards) and output for a chat that
   * was never opened. Replayed after the serialized buffer on the next open.
   */
  appendPendingData(terminalId: string, data: string): void {
    const existing = this.pendingData.get(terminalId) ?? ''
    this.pendingData.set(terminalId, trimFront(existing + data, MAX_PENDING_SIZE))
  }

  /** Return and clear the pending PTY output for a terminal ('' when none). */
  takePendingData(terminalId: string): string {
    const data = this.pendingData.get(terminalId) ?? ''
    this.pendingData.delete(terminalId)
    return data
  }

  /** Get stored serialized buffer for a terminal */
  getBuffer(terminalId: string): string | null {
    return this.serializedBuffers.get(terminalId) ?? null
  }

  /** Clear stored buffer for a terminal */
  clearBuffer(terminalId: string): void {
    this.serializedBuffers.delete(terminalId)
  }

  /** Get the number of currently active (non-evicted) terminals tracked */
  getActiveCount(): number {
    return this.lruOrder.filter((id) => !this.evictedSet.has(id)).length
  }

  /** Check if the pool needs eviction */
  needsEviction(): boolean {
    return this.getActiveCount() > this.maxSize
  }

  /**
   * Find the best eviction candidate.
   * Returns null if none available.
   */
  getEvictionCandidate(
    terminals: Record<string, TerminalSession>,
    activeTerminalId: string | null
  ): string | null {
    const candidates = this.lruOrder.filter((id) => {
      if (this.evictedSet.has(id)) return false
      if (id === activeTerminalId) return false
      // No live xterm registered (not opened yet, or already torn down):
      // nothing to evict, and picking it would abort the eviction loop.
      if (!this.serializers.has(id)) return false
      const terminal = terminals[id]
      if (!terminal) return false
      if (terminal.type === 'normal') return false // Sidecar terminals are lightweight — never evict
      if (PROTECTED_STATES.has(terminal.state)) return false
      return true
    })

    if (candidates.length === 0) return null

    // Prefer 'stopped' terminals, then least-recently-used
    candidates.sort((a, b) => {
      const aState = terminals[a]?.state
      const bState = terminals[b]?.state
      if (aState === 'stopped' && bState !== 'stopped') return -1
      if (bState === 'stopped' && aState !== 'stopped') return 1
      return this.lruOrder.indexOf(b) - this.lruOrder.indexOf(a)
    })

    return candidates[0]
  }

  /**
   * Evict a specific terminal. Serializes its buffer, calls cleanup, marks as evicted.
   * Returns true if eviction succeeded. Caller is responsible for notifying main process.
   */
  evict(terminalId: string): boolean {
    const serializeFn = this.serializers.get(terminalId)
    if (!serializeFn) return false

    // Serialize scrollback
    const serialized = serializeFn()
    if (serialized === null) {
      // Serialization failed — abort eviction
      return false
    }

    this.storeBuffer(terminalId, serialized)
    this.evictedSet.add(terminalId)

    // Destroy the xterm instance
    try {
      const cleanupFn = this.cleanups.get(terminalId)
      cleanupFn?.()
    } catch (err) {
      console.error(`[TerminalPool] Cleanup failed for ${terminalId}:`, err)
    }

    return true
  }

  /**
   * Evict a terminal whose component is unmounting while the session still
   * exists (project switch, panel teardown, remount). Unlike evict() this never
   * refuses once an xterm is registered: a failed serialization stores an empty
   * screen so the session still goes through the evicted/restore path and main
   * buffers its output instead of the renderer dropping it.
   * Returns true when the terminal is now evicted and main must be told to buffer.
   */
  evictOnUnmount(terminalId: string): boolean {
    if (!this.serializers.has(terminalId)) return false
    if (this.evict(terminalId)) return true

    this.storeBuffer(terminalId, '')
    this.evictedSet.add(terminalId)
    try {
      this.cleanups.get(terminalId)?.()
    } catch (err) {
      console.error(`[TerminalPool] Cleanup failed for ${terminalId}:`, err)
    }
    return true
  }

  /** Update max pool size */
  setMaxSize(size: number): void {
    const n = Number(size)
    if (Number.isNaN(n)) return
    this.maxSize = Math.max(2, Math.min(20, n))
  }

  getMaxSize(): number {
    return this.maxSize
  }
}

// Singleton instance
export const terminalPool = new TerminalPool()
