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

import type { BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import { spawn as ptySpawn } from 'node-pty'
import { TerminalManager } from '../electron/main/services/TerminalManager'
import { SpawnError } from '../electron/main/services/errors'

type MockBrowserWindow = Pick<BrowserWindow, 'isDestroyed' | 'webContents'>

function asBrowserWindow(w: MockBrowserWindow): BrowserWindow {
  return w as unknown as BrowserWindow
}

// Helper to flush setTimeout (the SHELL_READY_DELAY_MS timeout)
function flushTimers() {
  vi.runAllTimers()
}

describe('TerminalManager CLI flag construction', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
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

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining('--dangerously-skip-permissions')
    )
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
      resumeSessionId: 'invalid; rm -rf /', // injection attempt
    })
    flushTimers()

    const command = mockWrite.mock.calls[0][0] as string
    expect(command).not.toContain('--resume')
    expect(command).toContain('--enable-auto-mode')
  })

  test('codex Chat → launches interactive "codex\\r" without permission flags', () => {
    manager.createTerminal({ cwd: '/test', type: 'codex', claudeMode: 'chat' })
    flushTimers()
    expect(mockWrite).toHaveBeenCalledWith('codex\r')
  })

  test('codex Auto → keeps the default interactive command', () => {
    manager.createTerminal({ cwd: '/test', type: 'codex', claudeMode: 'auto' })
    flushTimers()
    expect(mockWrite).toHaveBeenCalledWith('codex\r')
  })

  test('codex Full Auto → writes exactly one approvals-and-sandbox bypass flag', () => {
    manager.createTerminal({ cwd: '/test', type: 'codex', claudeMode: 'full-auto' })
    flushTimers()
    expect(mockWrite).toHaveBeenCalledWith('codex --dangerously-bypass-approvals-and-sandbox\r')
  })

  test('codex Full Auto resume → keeps resume args before exactly one bypass flag', () => {
    manager.createTerminal({
      cwd: '/test',
      type: 'codex',
      resumeSessionId: 'uuid-1',
      claudeMode: 'full-auto',
    })
    flushTimers()
    expect(mockWrite).toHaveBeenCalledWith(
      'codex resume "uuid-1" --dangerously-bypass-approvals-and-sandbox\r'
    )
  })

  test('pi terminal → launches "pi\\r"', () => {
    manager.createTerminal({ cwd: '/test', type: 'pi' })
    flushTimers()
    expect(mockWrite).toHaveBeenCalledWith('pi\r')
  })
})

describe('TerminalManager hookless agent (pi) state heuristic', () => {
  let manager: TerminalManager
  const send = vi.fn()
  const mockWindow = { isDestroyed: vi.fn(() => false), webContents: { send } }

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The states emitted via the 'terminal:state' channel, in order.
  function emittedStates(): string[] {
    return send.mock.calls.filter((c) => c[0] === 'terminal:state').map((c) => c[2] as string)
  }

  test('pi cycles busy → done → busy as output flows and pauses (AE2)', () => {
    manager.createTerminal({ cwd: '/test', type: 'pi' })
    const onData = mockOnData.mock.calls[0][0] as (d: string) => void
    send.mockClear()

    // Terminal is already 'busy' from spawn; first output arms the quiet timer.
    onData('pi is working...')
    vi.advanceTimersByTime(1500)
    expect(emittedStates()).toContain('done') // went idle

    // New output transitions done → busy (an observable state change).
    send.mockClear()
    onData('more output')
    expect(emittedStates()).toContain('busy')

    // Quiet again → back to done.
    send.mockClear()
    vi.advanceTimersByTime(1500)
    expect(emittedStates()).toContain('done')
  })

  test('sustained pi output stays busy until output stops', () => {
    manager.createTerminal({ cwd: '/test', type: 'pi' })
    const onData = mockOnData.mock.calls[0][0] as (d: string) => void
    send.mockClear()

    onData('chunk 1')
    vi.advanceTimersByTime(1000)
    onData('chunk 2') // re-arms the quiet timer
    vi.advanceTimersByTime(1000)
    expect(emittedStates()).not.toContain('done')

    vi.advanceTimersByTime(600)
    expect(emittedStates()).toContain('done')
  })

  test('claude output does not trigger the heuristic (state comes from its hook)', () => {
    manager.createTerminal({ cwd: '/test', type: 'claude' })
    const onData = mockOnData.mock.calls[0][0] as (d: string) => void
    send.mockClear()

    onData('claude output')
    vi.advanceTimersByTime(2000)
    expect(emittedStates()).toHaveLength(0)
  })
})

describe('TerminalManager writeToTerminal chunking', () => {
  let manager: TerminalManager
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  }

  beforeEach(() => {
    // Real timers so setImmediate yields inside the chunker actually fire
    vi.useRealTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
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
  }
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.useRealTimers()
    mockWrite.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
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
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockWindow.webContents.send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
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
  }

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
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
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
  const mockWindow: MockBrowserWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() } as unknown as BrowserWindow['webContents'],
  }
  const mockedStat = statSync as unknown as ReturnType<typeof vi.fn>
  const mockedSpawn = ptySpawn as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    ;(mockWindow.webContents.send as ReturnType<typeof vi.fn>).mockClear()
    mockedStat.mockReset()
    mockedStat.mockReturnValue({ isDirectory: () => true })
    mockedSpawn.mockClear()
    manager = new TerminalManager(asBrowserWindow(mockWindow))
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

  test('statSync passes but pty.spawn throws synchronously → SpawnError code SPAWN_FAILED', () => {
    mockedStat.mockReturnValue({ isDirectory: () => true })
    mockedSpawn.mockImplementationOnce(() => {
      throw new Error('native pty failure')
    })

    try {
      manager.createTerminal({ cwd: '/test', type: 'normal' })
      throw new Error('expected SpawnError')
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnError)
      expect((err as SpawnError).code).toBe('SPAWN_FAILED')
    }
    // failure must not leak state
    expect(manager.hasActiveTerminals()).toBe(false)
  })
})

describe('TerminalManager PTY pipeline (terminal audit)', () => {
  let manager: TerminalManager
  const send = vi.fn()
  const mockWindow = { isDestroyed: vi.fn(() => false), webContents: { send } }
  const mockedSpawn = ptySpawn as unknown as ReturnType<typeof vi.fn>
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.useRealTimers()
    mockWrite.mockReset()
    mockOnData.mockClear()
    mockOnExit.mockClear()
    mockResize.mockReset()
    mockedSpawn.mockClear()
    send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  function createNormal(): string {
    const id = manager.createTerminal({ cwd: '/test', type: 'normal' })
    mockWrite.mockClear()
    send.mockClear()
    return id
  }

  function lastOnData(): (d: string) => void {
    return mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0] as (d: string) => void
  }

  function lastOnExit(): (e: { exitCode: number }) => void {
    return mockOnExit.mock.calls[mockOnExit.mock.calls.length - 1][0] as (e: {
      exitCode: number
    }) => void
  }

  function dataSentFor(id: string): string[] {
    return send.mock.calls
      .filter((c) => c[0] === 'terminal:data' && c[1] === id)
      .map((c) => c[2] as string)
  }

  function writes(): string {
    return mockWrite.mock.calls.map((c) => c[0] as string).join('')
  }

  // --- Finding 1: restore flush ordering -----------------------------------

  test('restore flushes the evicted buffer synchronously, before any newer PTY data', () => {
    const id = createNormal()
    const onData = lastOnData()
    manager.evictTerminal(id)
    onData('old-1 ')
    onData('old-2 ')
    manager.restoreTerminal(id)
    onData('new')
    expect(dataSentFor(id)).toEqual(['old-1 old-2 ', 'new'])
  })

  // --- Finding 2: mode-preserving evicted-buffer trim ----------------------

  test('evicted buffer over the 1MB cap keeps alt-screen/mouse modes from the dropped prefix', () => {
    const id = createNormal()
    const onData = lastOnData()
    manager.evictTerminal(id)
    onData('\x1b[?1049h\x1b[?1000;1006h\x1b[?2004h')
    onData('x'.repeat(1_048_576))
    onData('\ntail')
    manager.restoreTerminal(id)
    const [flushed] = dataSentFor(id)
    expect(flushed).toBe('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h' + 'tail')
  })

  // --- Finding 3: FIFO write ordering + surrogate-safe chunking ------------

  test('a keystroke typed during a large paste lands after the paste, not inside it', async () => {
    const id = createNormal()
    const paste = '\x1b[200~' + 'p'.repeat(3000) + '\x1b[201~'
    const pasteDone = manager.writeToTerminal(id, paste)
    const keyDone = manager.writeToTerminal(id, 'k')
    await Promise.all([pasteDone, keyDone])
    expect(writes()).toBe(paste + 'k')
  })

  test('binary input is written as raw bytes, in FIFO order behind a large paste', async () => {
    const id = createNormal()
    const paste = 'p'.repeat(3000)
    const mouse = Buffer.from('\x1b[M\x20\xa0\xa0', 'latin1')
    await Promise.all([manager.writeToTerminal(id, paste), manager.writeToTerminal(id, mouse)])
    const last = mockWrite.mock.calls[mockWrite.mock.calls.length - 1][0]
    expect(last).toBe(mouse)
    expect(mockWrite.mock.calls.slice(0, -1).map((c) => c[0] as string).join('')).toBe(paste)
  })

  test('two large pastes are written back to back without interleaving', async () => {
    const id = createNormal()
    const a = 'a'.repeat(2000)
    const b = 'b'.repeat(2000)
    await Promise.all([manager.writeToTerminal(id, a), manager.writeToTerminal(id, b)])
    expect(writes()).toBe(a + b)
  })

  test('a failing write does not wedge the queue for later writes', async () => {
    const id = createNormal()
    mockWrite.mockImplementationOnce(() => {
      throw new Error('EPIPE')
    })
    // First chunk throws → that write is abandoned (logged), the chain survives.
    await manager.writeToTerminal(id, 'f'.repeat(2000))
    await manager.writeToTerminal(id, 'after')
    expect(mockWrite.mock.calls[mockWrite.mock.calls.length - 1][0]).toBe('after')
  })

  test('a failing fast-path write is swallowed (no throw into the IPC handler)', async () => {
    const id = createNormal()
    mockWrite.mockImplementationOnce(() => {
      throw new Error('EPIPE')
    })
    await expect(manager.writeToTerminal(id, 'x')).resolves.toBeUndefined()
  })

  test('writeToPty (ccli path) queues behind a paste that is still chunking', async () => {
    const id = createNormal()
    const paste = 'q'.repeat(2000)
    const pasteDone = manager.writeToTerminal(id, paste)
    expect(manager.writeToPty(id, 'cmd\n')).toBe(true)
    await pasteDone
    await new Promise((r) => setImmediate(r))
    expect(writes()).toBe(paste + 'cmd\n')
  })

  test('closing a terminal drops its pending queue without writing further chunks', async () => {
    // Non-Windows so closeTerminal skips `taskkill /pid 12345` (the mock pid
    // could belong to a real process on the test machine).
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const id = createNormal()
    const pending = manager.writeToTerminal(id, 'z'.repeat(5000))
    manager.closeTerminal(id)
    await pending
    const written = writes()
    expect(written.length).toBeLessThan(5000)
    await manager.writeToTerminal(id, 'late')
    expect(writes()).toBe(written)
  })

  test('chunker never splits a surrogate pair across chunks', async () => {
    const id = createNormal()
    // Emoji starts at index 511, so a naive 512 boundary would cut it in half.
    const payload = 'a'.repeat(511) + '\u{1F600}' + 'b'.repeat(600)
    await manager.writeToTerminal(id, payload)
    const chunks = mockWrite.mock.calls.map((c) => c[0] as string)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
      const first = chunk.charCodeAt(0)
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
    }
    expect(chunks.join('')).toBe(payload)
  })

  // --- Finding 4: spawn size + TERM/COLORTERM ------------------------------

  function lastSpawnOptions(): { cols: number; rows: number; env: Record<string, string> } {
    const calls = mockedSpawn.mock.calls
    return calls[calls.length - 1][2] as { cols: number; rows: number; env: Record<string, string> }
  }

  test('spawns at the size passed by terminal:create', () => {
    manager.createTerminal({ cwd: '/test', type: 'normal', size: { cols: 160, rows: 48 } })
    expect(lastSpawnOptions()).toMatchObject({ cols: 160, rows: 48 })
  })

  test('without a size, the first terminal spawns at 80x24', () => {
    manager.createTerminal({ cwd: '/test', type: 'normal' })
    expect(lastSpawnOptions()).toMatchObject({ cols: 80, rows: 24 })
  })

  test('without a size, spawns at the last size applied to a terminal of the same kind', () => {
    const chat = manager.createTerminal({ cwd: '/test', type: 'claude' })
    const shell = manager.createTerminal({ cwd: '/test', type: 'normal' })
    manager.resizeTerminal(chat, 180, 50)
    manager.resizeTerminal(shell, 90, 20)

    manager.createTerminal({ cwd: '/test', type: 'codex' })
    expect(lastSpawnOptions()).toMatchObject({ cols: 180, rows: 50 })
    manager.createTerminal({ cwd: '/test', type: 'normal' })
    expect(lastSpawnOptions()).toMatchObject({ cols: 90, rows: 20 })
  })

  test('Windows: sets TERM and COLORTERM when the inherited env lacks them', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const saved = { TERM: process.env.TERM, COLORTERM: process.env.COLORTERM }
    delete process.env.TERM
    delete process.env.COLORTERM
    try {
      manager.createTerminal({ cwd: '/test', type: 'normal' })
      const { env } = lastSpawnOptions()
      expect(env.TERM).toBe('xterm-256color')
      expect(env.COLORTERM).toBe('truecolor')
    } finally {
      if (saved.TERM !== undefined) process.env.TERM = saved.TERM
      if (saved.COLORTERM !== undefined) process.env.COLORTERM = saved.COLORTERM
    }
  })

  test('Windows: an inherited TERM is left alone', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const saved = process.env.TERM
    process.env.TERM = 'screen-256color'
    try {
      manager.createTerminal({ cwd: '/test', type: 'normal' })
      expect(lastSpawnOptions().env.TERM).toBe('screen-256color')
    } finally {
      if (saved === undefined) delete process.env.TERM
      else process.env.TERM = saved
    }
  })

  // --- Finding 5: resize after exit -----------------------------------------

  test('resize on an already-exited PTY does not throw', () => {
    const id = createNormal()
    mockResize.mockImplementationOnce(() => {
      throw new Error('Cannot resize a pty that has already exited')
    })
    expect(() => manager.resizeTerminal(id, 100, 30)).not.toThrow()
  })

  // --- Finding 6: orphan exit still emits terminal:exit ---------------------

  test('orphaned spawn failure emits the spawn-failed toast AND stopped state + exit', () => {
    const id = createNormal()
    lastOnExit()({ exitCode: 1 })
    const channels = send.mock.calls.map((c) => c[0])
    expect(channels).toContain('terminal:spawn-failed')
    expect(send).toHaveBeenCalledWith('terminal:state', id, 'stopped')
    expect(send).toHaveBeenCalledWith('terminal:exit', id, 1)
  })

  test('normal exit after output emits state + exit without a spawn-failed toast', () => {
    const id = createNormal()
    lastOnData()('prompt$ ')
    send.mockClear()
    lastOnExit()({ exitCode: 0 })
    const channels = send.mock.calls.map((c) => c[0])
    expect(channels).not.toContain('terminal:spawn-failed')
    expect(send).toHaveBeenCalledWith('terminal:exit', id, 0)
  })
})

describe('TerminalManager Enter → busy heuristic', () => {
  let manager: TerminalManager
  const send = vi.fn()
  const mockWindow = { isDestroyed: vi.fn(() => false), webContents: { send } }

  beforeEach(() => {
    vi.useFakeTimers()
    mockWrite.mockClear()
    send.mockClear()
    manager = new TerminalManager(mockWindow as unknown as BrowserWindow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Put the cached state at 'done' so a busy transition would be observable.
  function settleToDone(id: string) {
    const terminals = (manager as unknown as { terminals: Map<string, { state: string }> })
      .terminals
    const t = terminals.get(id)
    if (!t) throw new Error('terminal not found')
    t.state = 'done'
    send.mockClear()
  }

  const busyEmits = () =>
    send.mock.calls.filter((c) => c[0] === 'terminal:state' && c[2] === 'busy')

  test.each([['claude'], ['codex']] as const)(
    'Enter on a hook-capable %s chat does not guess busy (UserPromptSubmit decides)',
    async (type) => {
      const id = manager.createTerminal({ cwd: '/test', type })
      await vi.runAllTimersAsync()
      settleToDone(id)
      await manager.writeToTerminal(id, '\r')
      expect(busyEmits()).toHaveLength(0)
    }
  )

  test('Enter on a hookless pi chat still marks it busy', async () => {
    const id = manager.createTerminal({ cwd: '/test', type: 'pi' })
    await vi.runAllTimersAsync()
    settleToDone(id)
    await manager.writeToTerminal(id, 'hi\r')
    expect(busyEmits()).toHaveLength(1)
  })
})
