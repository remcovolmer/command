import { describe, test, expect, vi, beforeEach } from 'vitest'
import { TerminalPool } from '../src/utils/terminalPool'
import type { TerminalSession } from '../src/types'

function makeTerminal(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'unused',
    projectId: 'p1',
    state: 'done',
    lastActivity: Date.now(),
    title: 'Chat',
    type: 'claude',
    worktreeId: null,
    ...overrides,
  } as TerminalSession
}

describe('TerminalPool', () => {
  let pool: TerminalPool

  beforeEach(() => {
    pool = new TerminalPool(3)
  })

  // A terminal with a live (registered) xterm, touched to the front of the LRU.
  function live(id: string): void {
    pool.registerCallbacks(id, () => `buf-${id}`, vi.fn())
    pool.touch(id)
  }

  // --- Constructor & setMaxSize ---

  describe('constructor / setMaxSize', () => {
    test('clamps maxSize to range 2-20', () => {
      expect(new TerminalPool(1).getMaxSize()).toBe(2)
      expect(new TerminalPool(50).getMaxSize()).toBe(20)
      expect(new TerminalPool(10).getMaxSize()).toBe(10)
    })

    test('setMaxSize clamps and handles NaN', () => {
      pool.setMaxSize(1)
      expect(pool.getMaxSize()).toBe(2)
      pool.setMaxSize(100)
      expect(pool.getMaxSize()).toBe(20)
      pool.setMaxSize(NaN)
      expect(pool.getMaxSize()).toBe(20) // unchanged
      pool.setMaxSize(7)
      expect(pool.getMaxSize()).toBe(7)
    })
  })

  // --- touch() LRU ordering ---

  describe('touch', () => {
    test('adds new terminal to front of LRU', () => {
      live('a')
      live('b')
      live('c')
      // c is most recent, a is least recent
      expect(pool.getActiveCount()).toBe(3)
    })

    test('moves existing terminal to front', () => {
      live('a')
      live('b')
      live('c')
      live('a') // move a to front

      // a should now be the most recently used
      // Verify by checking eviction candidate: least-recently-used is b
      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal(),
        b: makeTerminal(),
        c: makeTerminal(),
      }
      // With maxSize=3 and 3 terminals, needsEviction is false
      // But let's add a 4th and check candidate
      live('d')
      terminals.d = makeTerminal()

      const candidate = pool.getEvictionCandidate(terminals, 'd')
      // b is least recently used (order: d, a, c, b)
      expect(candidate).toBe('b')
    })

    test('is idempotent when terminal is already at front', () => {
      live('a')
      live('b')
      live('b') // already at front
      expect(pool.getActiveCount()).toBe(2)
    })
  })

  // --- needsEviction / getActiveCount ---

  describe('needsEviction', () => {
    test('returns false when under max size', () => {
      live('a')
      live('b')
      expect(pool.needsEviction()).toBe(false)
    })

    test('returns false when at max size', () => {
      live('a')
      live('b')
      live('c')
      expect(pool.needsEviction()).toBe(false)
    })

    test('returns true when over max size', () => {
      live('a')
      live('b')
      live('c')
      live('d')
      expect(pool.needsEviction()).toBe(true)
    })

    test('does not count evicted terminals as active', () => {
      live('a')
      live('b')
      live('c')
      live('d')

      // Evict one — needs callbacks registered
      pool.registerCallbacks('a', () => 'buffer', vi.fn())
      pool.evict('a')

      // 3 active (b, c, d) — at max, no eviction needed
      expect(pool.getActiveCount()).toBe(3)
      expect(pool.needsEviction()).toBe(false)
    })
  })

  // --- getEvictionCandidate ---

  describe('getEvictionCandidate', () => {
    test('returns least-recently-used terminal', () => {
      live('a')
      live('b')
      live('c')
      live('d')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal(),
        b: makeTerminal(),
        c: makeTerminal(),
        d: makeTerminal(),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'd')
      expect(candidate).toBe('a') // least recently used
    })

    test('excludes active terminal', () => {
      live('a')
      live('b')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal(),
        b: makeTerminal(),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'a')
      expect(candidate).toBe('b')
    })

    test('excludes protected states (busy, permission, question)', () => {
      live('a')
      live('b')
      live('c')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal({ state: 'busy' }),
        b: makeTerminal({ state: 'permission' }),
        c: makeTerminal({ state: 'done' }),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'c')
      expect(candidate).toBeNull() // a and b are protected, c is active
    })

    test('prefers stopped terminals over done', () => {
      live('a')
      live('b')
      live('c')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal({ state: 'done' }),
        b: makeTerminal({ state: 'stopped' }),
        c: makeTerminal({ state: 'done' }),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'c')
      expect(candidate).toBe('b') // stopped preferred
    })

    test('excludes already evicted terminals', () => {
      live('a')
      live('b')
      live('c')

      pool.registerCallbacks('a', () => 'buf', vi.fn())
      pool.evict('a')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal(),
        b: makeTerminal(),
        c: makeTerminal(),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'c')
      expect(candidate).toBe('b') // a is evicted, skipped
    })

    test('excludes sidecar (normal) terminals from eviction', () => {
      live('a')
      live('b')
      live('c')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal({ type: 'normal' }), // sidecar
        b: makeTerminal({ type: 'claude' }),
        c: makeTerminal({ type: 'claude' }),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'c')
      expect(candidate).toBe('b') // a is sidecar (protected), b is the only claude candidate
    })

    test('returns null when only sidecar terminals are candidates', () => {
      live('a')
      live('b')
      live('c')

      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal({ type: 'normal' }),
        b: makeTerminal({ type: 'normal' }),
        c: makeTerminal({ type: 'claude' }),
      }

      const candidate = pool.getEvictionCandidate(terminals, 'c')
      expect(candidate).toBeNull() // only sidecar terminals available, all protected
    })

    test('returns null when no candidates available', () => {
      live('a')
      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal(),
      }
      const candidate = pool.getEvictionCandidate(terminals, 'a')
      expect(candidate).toBeNull()
    })
  })

  // --- evict ---

  describe('evict', () => {
    test('serializes buffer, marks evicted, calls cleanup', () => {
      pool.touch('a')
      const cleanup = vi.fn()
      pool.registerCallbacks('a', () => 'serialized-data', cleanup)

      const result = pool.evict('a')

      expect(result).toBe(true)
      expect(pool.isEvicted('a')).toBe(true)
      expect(pool.getBuffer('a')).toBe('serialized-data')
      expect(cleanup).toHaveBeenCalledOnce()
    })

    test('aborts when serializer returns null', () => {
      pool.touch('a')
      const cleanup = vi.fn()
      pool.registerCallbacks('a', () => null, cleanup)

      const result = pool.evict('a')

      expect(result).toBe(false)
      expect(pool.isEvicted('a')).toBe(false)
      expect(pool.getBuffer('a')).toBeNull()
      expect(cleanup).not.toHaveBeenCalled()
    })

    test('returns false when no serializer registered', () => {
      pool.touch('a')
      const result = pool.evict('a')
      expect(result).toBe(false)
    })

    test('evicts terminal with empty string buffer', () => {
      pool.touch('a')
      const cleanup = vi.fn()
      pool.registerCallbacks('a', () => '', cleanup)

      const result = pool.evict('a')

      expect(result).toBe(true)
      expect(pool.isEvicted('a')).toBe(true)
      expect(pool.getBuffer('a')).toBe('')
      expect(cleanup).toHaveBeenCalledOnce()
      // Verify the terminal is not counted as active
      expect(pool.getActiveCount()).toBe(0)
    })
  })

  // --- storeBuffer / getBuffer / clearBuffer ---

  describe('storeBuffer', () => {
    test('stores and retrieves buffer', () => {
      pool.storeBuffer('a', 'hello world')
      expect(pool.getBuffer('a')).toBe('hello world')
    })

    test('truncates buffer exceeding 2MB at line boundary', () => {
      const bigData = 'line1\nline2\n' + 'x'.repeat(3 * 1024 * 1024)
      pool.storeBuffer('a', bigData)
      const stored = pool.getBuffer('a')!
      expect(stored.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    })

    test('clearBuffer removes stored buffer', () => {
      pool.storeBuffer('a', 'data')
      pool.clearBuffer('a')
      expect(pool.getBuffer('a')).toBeNull()
    })
  })

  // --- remove ---

  describe('remove', () => {
    test('cleans all internal state', () => {
      pool.touch('a')
      pool.registerCallbacks('a', () => 'buf', vi.fn())
      pool.evict('a')

      expect(pool.isEvicted('a')).toBe(true)
      expect(pool.getBuffer('a')).toBe('buf')

      pool.remove('a')

      expect(pool.isEvicted('a')).toBe(false)
      expect(pool.getBuffer('a')).toBeNull()
      expect(pool.getActiveCount()).toBe(0)
    })

    test('is safe to call for non-existent terminal', () => {
      pool.remove('nonexistent')
      expect(pool.getActiveCount()).toBe(0)
    })
  })

  // --- markRestored / isEvicted ---

  describe('markRestored', () => {
    test('clears evicted state', () => {
      pool.touch('a')
      pool.registerCallbacks('a', () => 'buf', vi.fn())
      pool.evict('a')

      expect(pool.isEvicted('a')).toBe(true)
      pool.markRestored('a')
      expect(pool.isEvicted('a')).toBe(false)
    })
  })

  // --- registerCallbacks / unregisterCallbacks ---

  describe('callbacks', () => {
    test('unregisterCallbacks prevents eviction', () => {
      pool.touch('a')
      pool.registerCallbacks('a', () => 'data', vi.fn())
      pool.unregisterCallbacks('a')

      const result = pool.evict('a')
      expect(result).toBe(false) // no serializer registered
    })
  })
  // --- unmount while the session still exists (project switch, panel teardown) ---

  describe('evictOnUnmount', () => {
    test('serializes, marks evicted and destroys the xterm', () => {
      const cleanup = vi.fn()
      pool.touch('a')
      pool.registerCallbacks('a', () => 'screen', cleanup)

      expect(pool.evictOnUnmount('a')).toBe(true)
      expect(pool.isEvicted('a')).toBe(true)
      expect(pool.getBuffer('a')).toBe('screen')
      expect(cleanup).toHaveBeenCalledOnce()
    })

    test('still evicts (empty screen) when serialization fails, so main buffers output', () => {
      const cleanup = vi.fn()
      pool.touch('a')
      pool.registerCallbacks('a', () => null, cleanup)

      expect(pool.evictOnUnmount('a')).toBe(true)
      expect(pool.isEvicted('a')).toBe(true)
      expect(pool.getBuffer('a')).toBe('')
      expect(cleanup).toHaveBeenCalledOnce()
    })

    test('is a no-op without a live xterm (never opened or already evicted)', () => {
      pool.touch('a')
      expect(pool.evictOnUnmount('a')).toBe(false)
      expect(pool.isEvicted('a')).toBe(false)
    })

    test('an unmount-evicted terminal frees its slot for the LRU count', () => {
      live('a')
      live('b')
      live('c')
      live('d')
      expect(pool.needsEviction()).toBe(true)
      pool.evictOnUnmount('a')
      expect(pool.needsEviction()).toBe(false)
    })
  })

  describe('getEvictionCandidate with terminals from several projects', () => {
    test('skips entries without a live xterm instead of blocking eviction', () => {
      // 'stale' was touched (e.g. activated in another project) but has no xterm.
      pool.touch('stale')
      live('b')
      live('c')
      const terminals: Record<string, TerminalSession> = {
        stale: makeTerminal({ projectId: 'p1' }),
        b: makeTerminal({ projectId: 'p2' }),
        c: makeTerminal({ projectId: 'p2' }),
      }
      expect(pool.getEvictionCandidate(terminals, 'c')).toBe('b')
    })

    test('protects busy chats of a non-active project', () => {
      live('a')
      live('b')
      live('c')
      const terminals: Record<string, TerminalSession> = {
        a: makeTerminal({ projectId: 'p1', state: 'busy' }),
        b: makeTerminal({ projectId: 'p1', state: 'permission' }),
        c: makeTerminal({ projectId: 'p2' }),
      }
      expect(pool.getEvictionCandidate(terminals, 'c')).toBeNull()
    })
  })

  // --- PTY output that arrives without a live xterm ---

  describe('pending data', () => {
    test('accumulates and is taken once', () => {
      pool.appendPendingData('a', 'one ')
      pool.appendPendingData('a', 'two')
      expect(pool.takePendingData('a')).toBe('one two')
      expect(pool.takePendingData('a')).toBe('')
    })

    test('is bounded to 1MB, keeping the tail from a line boundary', () => {
      const head = 'x'.repeat(600 * 1024) + '\n'
      const tail = 'y'.repeat(600 * 1024)
      pool.appendPendingData('a', head)
      pool.appendPendingData('a', tail)
      const data = pool.takePendingData('a')
      expect(data.length).toBeLessThanOrEqual(1024 * 1024)
      expect(data.endsWith('y')).toBe(true)
    })

    test('is dropped when the terminal is removed', () => {
      pool.appendPendingData('a', 'late')
      pool.remove('a')
      expect(pool.takePendingData('a')).toBe('')
    })
  })
})
