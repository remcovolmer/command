import type { TerminalSession } from '../types'

const MAX_SERIALIZED_SIZE = 2 * 1024 * 1024 // 2MB per terminal

// Terminal states that are protected from eviction (require user attention)
const PROTECTED_STATES = new Set(['busy', 'permission', 'question'])

type SerializeFn = () => string | null
type CleanupFn = () => void

export class TerminalPool {
  private maxSize: number
  private lruOrder: string[] = [] // terminal IDs, most-recent first
  private serializedBuffers: Map<string, string> = new Map()
  private evictedSet: Set<string> = new Set()

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
    if (serialized.length > MAX_SERIALIZED_SIZE) {
      const truncateAt = serialized.length - MAX_SERIALIZED_SIZE
      const lineBreak = serialized.indexOf('\n', truncateAt)
      this.serializedBuffers.set(
        terminalId,
        lineBreak !== -1 ? serialized.slice(lineBreak + 1) : serialized.slice(truncateAt)
      )
    } else {
      this.serializedBuffers.set(terminalId, serialized)
    }
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
    return this.lruOrder.filter(id => !this.evictedSet.has(id)).length
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
    activeTerminalId: string | null,
    splitTerminalIds: string[]
  ): string | null {
    const splitSet = new Set(splitTerminalIds)

    const candidates = this.lruOrder.filter(id => {
      if (this.evictedSet.has(id)) return false
      if (id === activeTerminalId) return false
      if (splitSet.has(id)) return false
      const terminal = terminals[id]
      if (!terminal) return false
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
   * Returns true if eviction succeeded.
   */
  evict(terminalId: string, api: { terminal: { evict: (id: string) => void } }): boolean {
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

    // Notify main process to start buffering
    api.terminal.evict(terminalId)

    // Destroy the xterm instance
    const cleanupFn = this.cleanups.get(terminalId)
    cleanupFn?.()

    return true
  }

  /** Update max pool size */
  setMaxSize(size: number): void {
    this.maxSize = Math.max(2, Math.min(20, size))
  }

  getMaxSize(): number {
    return this.maxSize
  }
}

// Singleton instance
export const terminalPool = new TerminalPool()
