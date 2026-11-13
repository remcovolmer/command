import { describe, test, expect, vi, beforeEach } from 'vitest'

// terminalEvents' default sink reads the real store; every test injects its
// own sink, so a stub keeps the store (and its persist middleware) out.
vi.mock('../src/stores/projectStore', () => ({
  useProjectStore: { getState: () => ({ terminals: {} }) },
}))

import { TerminalEventManager, type TerminalEventSink } from '../src/utils/terminalEvents'
import { TerminalPool } from '../src/utils/terminalPool'

type Handler = (...args: unknown[]) => void

/** Minimal electronAPI double: records each on*() handler under its name. */
function createFakeApi() {
  const handlers = new Map<string, Handler>()
  const register = (name: string) => (handler: Handler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }
  const terminal = Object.fromEntries(
    [
      'onData',
      'onStateChange',
      'onExit',
      'onTitleChange',
      'onWorktreeUpdated',
      'onSummaryChange',
      'onGeneratedTitleChange',
      'onSessionRestored',
      'onSidecarCreated',
      'onStatusMessage',
      'onSpawnFailed',
    ].map((name) => [name, register(name)])
  )
  const editor = { onOpenFile: register('onOpenFile'), onOpenBrowser: register('onOpenBrowser') }
  const emit = (name: string, ...args: unknown[]) => {
    const handler = handlers.get(name)
    if (!handler) throw new Error(`no handler for ${name}`)
    handler(...args)
  }
  return { api: { terminal, editor } as unknown as typeof window.electronAPI, emit }
}

function createSink(known: string[] = []) {
  const ids = new Set(known)
  return {
    hasTerminal: vi.fn((id: string) => ids.has(id)),
    updateTerminalState: vi.fn(),
    updateTerminalTitle: vi.fn(),
  } satisfies TerminalEventSink
}

describe('TerminalEventManager', () => {
  let fake: ReturnType<typeof createFakeApi>
  let sink: ReturnType<typeof createSink>
  let pool: TerminalPool
  let events: TerminalEventManager

  beforeEach(() => {
    fake = createFakeApi()
    sink = createSink(['t1', 't2'])
    pool = new TerminalPool()
    events = new TerminalEventManager({ getApi: () => fake.api, sink, pool })
    events.init()
  })

  describe('global state/title dispatch', () => {
    test('updates the store for a terminal without a subscribed xterm', () => {
      fake.emit('onStateChange', 't1', 'permission')
      expect(sink.updateTerminalState).toHaveBeenCalledWith('t1', 'permission')
    })

    test('keeps the state validity guard', () => {
      fake.emit('onStateChange', 't1', 'bogus')
      expect(sink.updateTerminalState).not.toHaveBeenCalled()
    })

    test('state still reaches the store after unsubscribe (evicted chat)', () => {
      events.subscribe('t1', vi.fn())
      events.unsubscribe('t1')
      fake.emit('onStateChange', 't1', 'done')
      expect(sink.updateTerminalState).toHaveBeenCalledWith('t1', 'done')
    })

    test('title goes to the store by default', () => {
      fake.emit('onTitleChange', 't1', 'My chat')
      expect(sink.updateTerminalTitle).toHaveBeenCalledWith('t1', 'My chat')
    })

    test('a per-terminal title callback overrides the store update', () => {
      const onTitle = vi.fn()
      events.subscribe('t1', vi.fn(), undefined, onTitle)
      fake.emit('onTitleChange', 't1', 'Custom')
      expect(onTitle).toHaveBeenCalledWith('Custom')
      expect(sink.updateTerminalTitle).not.toHaveBeenCalled()
    })

    test('exit is still delivered to a subscribed xterm', () => {
      const onExit = vi.fn()
      events.subscribe('t1', vi.fn(), onExit)
      fake.emit('onExit', 't1', 0)
      expect(onExit).toHaveBeenCalledWith(0)
    })
  })

  describe('data routing', () => {
    test('goes to the subscribed xterm', () => {
      const onData = vi.fn()
      events.subscribe('t1', onData)
      fake.emit('onData', 't1', 'hello')
      expect(onData).toHaveBeenCalledWith('hello')
      expect(pool.takePendingData('t1')).toBe('')
    })

    test('data in flight after eviction is parked in the pool, in order', () => {
      events.subscribe('t1', vi.fn())
      // Eviction: the xterm is destroyed and unsubscribed synchronously, while
      // main may already have sent more data before it processes terminal:evict.
      events.unsubscribe('t1')
      fake.emit('onData', 't1', 'late-1 ')
      fake.emit('onData', 't1', 'late-2')
      expect(pool.takePendingData('t1')).toBe('late-1 late-2')
    })

    test('data for a known but never-opened chat is kept for its first open', () => {
      fake.emit('onData', 't2', '\x1b[?1049h\x1b[?1006h')
      expect(pool.takePendingData('t2')).toBe('\x1b[?1049h\x1b[?1006h')
    })

    test('data for an unknown terminal is dropped (no unbounded growth)', () => {
      fake.emit('onData', 'ghost', 'noise')
      expect(pool.takePendingData('ghost')).toBe('')
    })
  })
})
