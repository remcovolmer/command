import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Capture the last pty.write() call to verify CLI flag construction
const mockWrite = vi.fn()
const mockOnData = vi.fn()
const mockOnExit = vi.fn()
const mockResize = vi.fn()
const mockKill = vi.fn()

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => ({
      pid: 12345,
      write: mockWrite,
      onData: mockOnData,
      onExit: mockOnExit,
      resize: mockResize,
      kill: mockKill,
    })),
  },
  spawn: vi.fn(() => ({
    pid: 12345,
    write: mockWrite,
    onData: mockOnData,
    onExit: mockOnExit,
    resize: mockResize,
    kill: mockKill,
  })),
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

import { TerminalManager } from '../electron/main/services/TerminalManager'

// Helper to flush setTimeout (the SHELL_READY_DELAY_MS timeout)
function flushTimers() {
  vi.runAllTimers()
}

describe('TerminalManager CLI flag construction', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow)
  })

  test('claudeMode: chat → command is "claude\\r" (no flags)', () => {
    manager.createTerminal({ cwd: '/test', claudeMode: 'chat' })
    flushTimers()

    expect(mockWrite).toHaveBeenCalledWith('claude\r')
  })

  test('claudeMode: auto → command contains --enable-auto-mode', () => {
    manager.createTerminal({ cwd: '/test', claudeMode: 'auto' })
    flushTimers()

    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('--enable-auto-mode'))
    expect(mockWrite).toHaveBeenCalledWith(expect.stringMatching(/^claude /))
  })

  test('claudeMode: full-auto → command contains --dangerously-skip-permissions', () => {
    manager.createTerminal({ cwd: '/test', claudeMode: 'full-auto' })
    flushTimers()

    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('--dangerously-skip-permissions'))
  })

  test('claudeMode: undefined → command is "claude\\r" (no flags)', () => {
    manager.createTerminal({ cwd: '/test' })
    flushTimers()

    expect(mockWrite).toHaveBeenCalledWith('claude\r')
  })

  test('claudeMode: auto + resumeSessionId → both --resume and --enable-auto-mode present', () => {
    manager.createTerminal({
      cwd: '/test',
      claudeMode: 'auto',
      resumeSessionId: 'abc-123_session',
    })
    flushTimers()

    const command = mockWrite.mock.calls[0][0] as string
    expect(command).toContain('--resume')
    expect(command).toContain('abc-123_session')
    expect(command).toContain('--enable-auto-mode')
    expect(command).toMatch(/\r$/)
  })

  test('normal terminal type → no claude command written', () => {
    manager.createTerminal({ cwd: '/test', type: 'normal' })
    flushTimers()

    // For normal terminals, no claude command is written
    expect(mockWrite).not.toHaveBeenCalled()
  })

  test('invalid resumeSessionId is ignored', () => {
    manager.createTerminal({
      cwd: '/test',
      claudeMode: 'auto',
      resumeSessionId: 'invalid; rm -rf /',  // injection attempt
    })
    flushTimers()

    const command = mockWrite.mock.calls[0][0] as string
    expect(command).not.toContain('--resume')
    expect(command).toContain('--enable-auto-mode')
  })
})

describe('TerminalManager writeToTerminal chunking', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any

  beforeEach(() => {
    // Real timers so setImmediate yields inside the chunker actually fire
    vi.useRealTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow)
  })

  function createNormalTerminal(): string {
    // type: 'normal' does not schedule the SHELL_READY_DELAY_MS claude command,
    // so mockWrite stays clean until we invoke writeToTerminal explicitly.
    const id = manager.createTerminal({ cwd: '/test', type: 'normal' })
    mockWrite.mockClear()
    return id
  }

  function concatWrites(): string {
    return mockWrite.mock.calls.map((c) => c[0] as string).join('')
  }

  test('small payload (100B) uses fast path: single write with full payload', async () => {
    const id = createNormalTerminal()
    const payload = 'x'.repeat(100)
    await manager.writeToTerminal(id, payload)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(payload)
  })

  test('exactly 512B stays on fast path: single write', async () => {
    const id = createNormalTerminal()
    const payload = 'a'.repeat(512)
    await manager.writeToTerminal(id, payload)
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(payload)
  })

  test('513B payload splits into multiple chunks and round-trips', async () => {
    const id = createNormalTerminal()
    const payload = 'b'.repeat(513)
    await manager.writeToTerminal(id, payload)
    expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(concatWrites()).toBe(payload)
  })

  test('10000B payload chunks and round-trips byte-for-byte', async () => {
    const id = createNormalTerminal()
    const payload = 'c'.repeat(10000)
    await manager.writeToTerminal(id, payload)
    expect(mockWrite.mock.calls.length).toBeGreaterThan(10)
    expect(concatWrites()).toBe(payload)
  })

  test('empty payload is a no-op', async () => {
    const id = createNormalTerminal()
    await manager.writeToTerminal(id, '')
    expect(mockWrite).not.toHaveBeenCalled()
  })

  test('bracketed-paste start marker straddling chunk boundary is kept intact', async () => {
    const id = createNormalTerminal()
    // Place \x1b[200~ so a naive 512-byte split would cut it mid-marker.
    const leader = 'a'.repeat(509) // marker starts at pos 509, spans 509..514 (6 bytes)
    const body = 'b'.repeat(500)
    const payload = leader + '\x1b[200~' + body + '\x1b[201~'

    await manager.writeToTerminal(id, payload)
    const chunks = mockWrite.mock.calls.map((c) => c[0] as string)

    // No chunk should end with a partial marker prefix
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/\x1b$/)
      expect(chunk).not.toMatch(/\x1b\[$/)
      expect(chunk).not.toMatch(/\x1b\[2$/)
      expect(chunk).not.toMatch(/\x1b\[20$/)
      expect(chunk).not.toMatch(/\x1b\[200$/)
    }
    // Exactly one chunk contains the full start marker
    expect(chunks.filter((c) => c.includes('\x1b[200~')).length).toBe(1)
    // Round-trip equals original
    expect(chunks.join('')).toBe(payload)
  })

  test('bracketed-paste end marker straddling chunk boundary is kept intact', async () => {
    const id = createNormalTerminal()
    // Position \x1b[201~ so the naive 512 boundary would cut through it.
    // Start marker + 503 bytes body puts end marker at pos 509..514.
    const payload = '\x1b[200~' + 'x'.repeat(503) + '\x1b[201~' + 'tail'

    await manager.writeToTerminal(id, payload)
    const chunks = mockWrite.mock.calls.map((c) => c[0] as string)

    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/\x1b$/)
      expect(chunk).not.toMatch(/\x1b\[$/)
    }
    expect(chunks.filter((c) => c.includes('\x1b[201~')).length).toBe(1)
    expect(chunks.join('')).toBe(payload)
  })

  test('large payload wrapped in bracketed paste round-trips on non-Windows platforms', async () => {
    // Note: default test platform (darwin/linux) preserves \r bytes inside pastes.
    const originalPlatform = process.platform
    if (originalPlatform === 'win32') {
      Object.defineProperty(process, 'platform', { value: 'linux' })
    }

    try {
      const id = createNormalTerminal()
      const body = 'line1\r\n' + 'x'.repeat(2000) + '\r\nline2'
      const payload = '\x1b[200~' + body + '\x1b[201~'
      await manager.writeToTerminal(id, payload)
      expect(concatWrites()).toBe(payload)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })
})

describe('TerminalManager writeToTerminal Windows CRLF handling', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.useRealTimers()
    mockWrite.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  test('Windows: strips \\r inside a bracketed-paste block', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const id = manager.createTerminal({ cwd: '/test', type: 'normal' })
    mockWrite.mockClear()

    const body = 'line1\r\n' + 'x'.repeat(2000) + '\r\nline2'
    const payload = '\x1b[200~' + body + '\x1b[201~'
    await manager.writeToTerminal(id, payload)

    const reassembled = mockWrite.mock.calls.map((c) => c[0] as string).join('')
    const expected = '\x1b[200~' + body.replace(/\r/g, '') + '\x1b[201~'
    expect(reassembled).toBe(expected)
  })

  test('Windows: preserves \\r outside any bracketed-paste block', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const id = manager.createTerminal({ cwd: '/test', type: 'normal' })
    mockWrite.mockClear()

    // Large \r-heavy payload with no markers: should be untouched byte-for-byte.
    const payload = 'line\r\n'.repeat(200) // 1200 bytes
    await manager.writeToTerminal(id, payload)

    const reassembled = mockWrite.mock.calls.map((c) => c[0] as string).join('')
    expect(reassembled).toBe(payload)
  })

  test('non-Windows: preserves \\r inside bracketed-paste block', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const id = manager.createTerminal({ cwd: '/test', type: 'normal' })
    mockWrite.mockClear()

    const body = 'line1\r\n' + 'x'.repeat(2000) + '\r\nline2'
    const payload = '\x1b[200~' + body + '\x1b[201~'
    await manager.writeToTerminal(id, payload)

    const reassembled = mockWrite.mock.calls.map((c) => c[0] as string).join('')
    expect(reassembled).toBe(payload)
  })
})

describe('TerminalManager writeToTerminal Claude terminal integration', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow)
  })

  test('short Enter-bearing input on a Claude terminal reaches pty.write intact', async () => {
    const id = manager.createTerminal({ cwd: '/test', claudeMode: 'chat' })
    // Drain the SHELL_READY_DELAY_MS timer that writes the initial `claude\r` command
    await vi.runAllTimersAsync()
    mockWrite.mockClear()

    // Real timers so the chunker's setImmediate yields fire (even though this
    // payload stays on the fast path, we exercise the async path end-to-end)
    vi.useRealTimers()

    await manager.writeToTerminal(id, 'hello\n')

    // The input must still reach the PTY exactly once and unchanged
    expect(mockWrite).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith('hello\n')
  })

  test('large paste on a Claude terminal reaches pty.write chunked and intact', async () => {
    const id = manager.createTerminal({ cwd: '/test', claudeMode: 'chat' })
    await vi.runAllTimersAsync()
    mockWrite.mockClear()
    vi.useRealTimers()

    // Simulate a bracketed-paste payload delivered by xterm, large enough to chunk
    const body = 'const answer = 42;\n'.repeat(60) // ~1140 bytes
    const payload = '\x1b[200~' + body + '\x1b[201~'
    await manager.writeToTerminal(id, payload)

    const reassembled = mockWrite.mock.calls.map((c) => c[0] as string).join('')
    if (process.platform === 'win32') {
      // Windows strips \r inside bracketed paste; synthesize expected
      const expected = '\x1b[200~' + body.replace(/\r/g, '') + '\x1b[201~'
      expect(reassembled).toBe(expected)
    } else {
      expect(reassembled).toBe(payload)
    }
    expect(mockWrite.mock.calls.length).toBeGreaterThan(1)
  })
})
