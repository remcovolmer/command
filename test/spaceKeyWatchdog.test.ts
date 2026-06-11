import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSpaceKeyWatchdog } from '../src/utils/spaceKeyWatchdog'

const WINDOW_MS = 80

function spaceKeydown(overrides: Partial<{
  type: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  isComposing: boolean
}> = {}) {
  return {
    type: 'keydown',
    code: 'Space',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  }
}

describe('spaceKeyWatchdog', () => {
  let writeSpace: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    writeSpace = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createWatchdog() {
    return createSpaceKeyWatchdog({
      writeSpace,
      windowMs: WINDOW_MS,
      // Fake timers mock Date, so Date.now() advances with advanceTimersByTime
      now: () => Date.now(),
    })
  }

  test('injects a space when a space keydown produces no data (IME ate it)', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown())

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).toHaveBeenCalledTimes(1)
  })

  test('does not inject when the space arrives normally via onData', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown())
    // Normal path: xterm emits the space synchronously in the same dispatch
    watchdog.handleData(' ')

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('does not inject when a composition flush containing a space arrives within the window', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown())

    // Composition flushes are deferred via setTimeout(0)
    vi.advanceTimersByTime(5)
    watchdog.handleData('woord ')
    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('non-space data within the window does not suppress injection', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown())

    vi.advanceTimersByTime(5)
    watchdog.handleData('a')
    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).toHaveBeenCalledTimes(1)
  })

  test('earlier space data does not suppress a later dropped space', () => {
    const watchdog = createWatchdog()
    // First space works normally
    watchdog.handleKeyEvent(spaceKeydown())
    watchdog.handleData(' ')
    vi.advanceTimersByTime(WINDOW_MS)
    expect(writeSpace).not.toHaveBeenCalled()

    // Second space gets eaten
    vi.advanceTimersByTime(10)
    watchdog.handleKeyEvent(spaceKeydown())
    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).toHaveBeenCalledTimes(1)
  })

  test('injects one space per dropped keydown (key repeat)', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown())
    vi.advanceTimersByTime(30)
    watchdog.handleKeyEvent(spaceKeydown())
    vi.advanceTimersByTime(30)
    watchdog.handleKeyEvent(spaceKeydown())

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).toHaveBeenCalledTimes(3)
  })

  test('ignores keyup events', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown({ type: 'keyup' }))

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('ignores non-space keys', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown({ code: 'KeyA' }))

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('ignores modified spaces (Ctrl/Alt/Meta+Space)', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown({ ctrlKey: true }))
    watchdog.handleKeyEvent(spaceKeydown({ altKey: true }))
    watchdog.handleKeyEvent(spaceKeydown({ metaKey: true }))

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('ignores spaces during real IME composition (CJK candidate selection)', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown({ isComposing: true }))

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('dispose cancels pending injections', () => {
    const watchdog = createWatchdog()
    watchdog.handleKeyEvent(spaceKeydown())
    watchdog.dispose()

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })

  test('does nothing after dispose', () => {
    const watchdog = createWatchdog()
    watchdog.dispose()
    watchdog.handleKeyEvent(spaceKeydown())

    vi.advanceTimersByTime(WINDOW_MS)

    expect(writeSpace).not.toHaveBeenCalled()
  })
})
