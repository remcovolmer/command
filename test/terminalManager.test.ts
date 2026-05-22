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

// Default: cwd validation passes. Individual tests override statSync for
// missing-dir / not-a-dir scenarios.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    statSync: vi.fn(() => ({ isDirectory: () => true })),
    accessSync: vi.fn(),
  }
})

import { statSync } from 'node:fs'
import { TerminalManager } from '../electron/main/services/TerminalManager'
import { SpawnError } from '../electron/main/services/errors'

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

describe('TerminalManager auto-naming: ANSI stripping', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any

  // Helper: return the title arg from the last terminal:title call for `id`, or null
  function lastTitleFor(id: string): string | null {
    const calls = mockWindow.webContents.send.mock.calls as unknown[][]
    for (let i = calls.length - 1; i >= 0; i--) {
      const call = calls[i]
      if (call[0] === 'terminal:title' && call[1] === id) return call[2] as string
    }
    return null
  }

  async function createClaudeTerminal(opts: { initialTitle?: string } = {}): Promise<string> {
    vi.useFakeTimers()
    const id = manager.createTerminal({ cwd: '/test', claudeMode: 'chat', ...opts })
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    // Clear setup events so assertions only see what the test itself produces
    mockWindow.webContents.send.mockClear()
    mockWrite.mockClear()
    return id
  }

  beforeEach(() => {
    mockWrite.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow)
  })

  test('plain text input produces a clean, capitalized title (regression guard)', async () => {
    const id = await createClaudeTerminal()
    // xterm delivers typed characters as separate PTY events; Enter arrives on its own.
    await manager.writeToTerminal(id, 'refactor terminal pool')
    await manager.writeToTerminal(id, '\r')
    expect(lastTitleFor(id)).toBe('Refactor terminal pool')
  })

  test('SGR mouse-tracking reports never reach the title buffer', async () => {
    const id = await createClaudeTerminal()
    // Mouse events arrive before the user types, then the actual prompt, then Enter.
    const mouseNoise = '\x1b[<35;103;14M\x1b[<35;100;15M\x1b[<0;96;16M'
    await manager.writeToTerminal(id, mouseNoise)
    await manager.writeToTerminal(id, 'hello world')
    await manager.writeToTerminal(id, '\r')
    expect(lastTitleFor(id)).toBe('Hello world')
  })

  test('mouse-tracking reports interleaved with typing still produce a clean title', async () => {
    const id = await createClaudeTerminal()
    // xterm may deliver mouse bytes in the same data callback as typed characters.
    await manager.writeToTerminal(id, 'fix \x1b[<32;50;20Mbug\x1b[<35;60;20m in parser')
    await manager.writeToTerminal(id, '\r')
    expect(lastTitleFor(id)).toBe('Fix bug in parser')
  })

  test('SS3 arrow-key sequences are stripped entirely, including the final byte', async () => {
    const id = await createClaudeTerminal()
    // Application-mode arrow keys: ESC O A/B/C/D. All three bytes must go,
    // otherwise a stray 'A'/'B' would leak into the title.
    await manager.writeToTerminal(id, '\x1bOA\x1bOB')
    await manager.writeToTerminal(id, 'deploy')
    await manager.writeToTerminal(id, '\r')
    expect(lastTitleFor(id)).toBe('Deploy')
  })

  test('OSC sequences (ESC ] … BEL) are stripped; only trailing text becomes the title', async () => {
    const id = await createClaudeTerminal()
    // PTY stdin rarely carries OSC, but we strip it as cheap insurance.
    await manager.writeToTerminal(id, '\x1b]0;ignored window title\x07task name')
    await manager.writeToTerminal(id, '\r')
    expect(lastTitleFor(id)).toBe('Task name')
  })

  test('bracketed-paste markers are stripped — only the pasted text forms the title', async () => {
    const id = await createClaudeTerminal()
    await manager.writeToTerminal(id, '\x1b[200~investigate flaky test\x1b[201~')
    await manager.writeToTerminal(id, '\r')
    expect(lastTitleFor(id)).toBe('Investigate flaky test')
  })

  test('noise-only input (mouse events, no real text) does not set a title', async () => {
    const id = await createClaudeTerminal()
    await manager.writeToTerminal(id, '\x1b[<35;103;14M\x1b[<35;100;15M\r')
    expect(lastTitleFor(id)).toBeNull()
  })

  test('already-titled terminals ignore mouse noise (no retitle)', async () => {
    const id = await createClaudeTerminal({ initialTitle: 'Seeded' })
    // Untitled-gate at writeToTerminal short-circuits; mouse bytes should never
    // trigger a new terminal:title event.
    await manager.writeToTerminal(id, '\x1b[<35;103;14M\x1b[<35;100;15Mfoo\r')
    const titles = (mockWindow.webContents.send.mock.calls as unknown[][])
      .filter((c) => c[0] === 'terminal:title' && c[1] === id)
      .map((c) => c[2])
    expect(titles).toEqual([])
  })
})

describe('TerminalManager createTerminal cwd validation', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  } as any
  const mockedStat = statSync as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    mockWindow.webContents.send.mockClear()
    mockedStat.mockReset()
    mockedStat.mockReturnValue({ isDirectory: () => true })
    manager = new TerminalManager(mockWindow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('missing cwd → throws SpawnError with code CWD_MISSING', () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockedStat.mockImplementation(() => {
      throw enoent
    })

    expect(() => manager.createTerminal({ cwd: 'C:\\does\\not\\exist' })).toThrowError(SpawnError)
    try {
      manager.createTerminal({ cwd: 'C:\\does\\not\\exist' })
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnError)
      expect((err as SpawnError).code).toBe('CWD_MISSING')
      expect((err as SpawnError).cwd).toBe('C:\\does\\not\\exist')
    }
  })

  test('cwd is a file (not a directory) → throws SpawnError with code CWD_NOT_DIR', () => {
    mockedStat.mockReturnValue({ isDirectory: () => false })

    expect(() => manager.createTerminal({ cwd: 'C:\\some\\file.txt' })).toThrowError(SpawnError)
    try {
      manager.createTerminal({ cwd: 'C:\\some\\file.txt' })
    } catch (err) {
      expect((err as SpawnError).code).toBe('CWD_NOT_DIR')
    }
  })

  test('unexpected stat error (EACCES) → throws SpawnError with code SPAWN_FAILED', () => {
    const eacces: NodeJS.ErrnoException = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockedStat.mockImplementation(() => {
      throw eacces
    })

    try {
      manager.createTerminal({ cwd: 'C:\\protected' })
      throw new Error('expected SpawnError')
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnError)
      expect((err as SpawnError).code).toBe('SPAWN_FAILED')
    }
  })

  test('failure does not leak state: terminals map stays empty after CWD_MISSING', () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockedStat.mockImplementation(() => {
      throw enoent
    })

    expect(() => manager.createTerminal({ cwd: 'C:\\gone' })).toThrow(SpawnError)
    expect(manager.hasActiveTerminals()).toBe(false)
  })

  test('valid cwd → succeeds and returns terminal id', () => {
    mockedStat.mockReturnValue({ isDirectory: () => true })
    const id = manager.createTerminal({ cwd: '/test', type: 'normal' })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(manager.hasActiveTerminals()).toBe(true)
  })
})
