import { describe, test, expect, vi, beforeEach } from 'vitest'

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
