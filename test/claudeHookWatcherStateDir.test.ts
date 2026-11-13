import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Real filesystem in a temp ~/.claude — never the user's real state files.
vi.mock('../electron/main/services/Logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import {
  ClaudeHookWatcher,
  STATE_DIR_NAME,
  LEGACY_STATE_FILE_NAME,
} from '../electron/main/services/ClaudeHookWatcher'

const require = createRequire(import.meta.url)
const { recordState } = require('../electron/main/hooks/claude-state-hook.cjs') as {
  recordState: (
    stateDir: string,
    data: Record<string, unknown>,
    env: Record<string, string | undefined>
  ) => Promise<string>
}

const SID = 'aaaaaaaa-1111-4111-8111-111111111111'
const SID2 = 'bbbbbbbb-2222-4222-8222-222222222222'
const T1 = 'cccccccc-3333-4333-8333-333333333333'
const T2 = 'dddddddd-4444-4444-8444-444444444444'
const CWD = 'C:/projects/foo'

function createMockWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as import('electron').BrowserWindow
}

describe('ClaudeHookWatcher per-session state directory', () => {
  let claudeDir: string
  let stateDir: string
  let win: ReturnType<typeof createMockWindow>
  let watcher: ClaudeHookWatcher

  const emitted = () =>
    (
      win as unknown as { webContents: { send: ReturnType<typeof vi.fn> } }
    ).webContents.send.mock.calls
      .filter((c) => c[0] === 'terminal:state')
      .map((c) => [c[1], c[2]])

  const writeEntry = (name: string, entry: Record<string, unknown>) =>
    writeFileSync(join(stateDir, name), JSON.stringify(entry))

  const entry = (overrides: Record<string, unknown> = {}) => ({
    session_id: SID,
    cwd: CWD,
    state: 'busy',
    timestamp: Date.now(),
    hook_event: 'UserPromptSubmit',
    terminal_id: T1,
    ...overrides,
  })

  beforeEach(() => {
    claudeDir = mkdtempSync(join(tmpdir(), 'hook-watcher-dir-'))
    stateDir = join(claudeDir, STATE_DIR_NAME)
    mkdirSync(stateDir, { recursive: true })
    win = createMockWindow()
    watcher = new ClaudeHookWatcher(win, { claudeDir })
    watcher.registerTerminal(T1, CWD)
    watcher.registerTerminal(T2, CWD)
  })

  afterEach(() => {
    watcher.destroy()
    rmSync(claudeDir, { recursive: true, force: true })
  })

  test('end to end: the real hook writes a session file, one poll routes it by terminal id', async () => {
    // Session started in T2 although T1 is the first terminal in this cwd.
    await recordState(
      stateDir,
      { session_id: SID, cwd: CWD, hook_event_name: 'SessionStart', source: 'startup' },
      { COMMAND_CENTER_TERMINAL_ID: T2 }
    )
    await watcher.pollStateDir()
    expect(emitted()).toEqual([[T2, 'busy']])
    expect(watcher.getTerminalSessions()).toEqual([{ terminalId: T2, sessionId: SID }])
  })

  test('two sessions written concurrently both reach their chats', async () => {
    await Promise.all([
      recordState(
        stateDir,
        { session_id: SID, cwd: CWD, hook_event_name: 'Stop' },
        { COMMAND_CENTER_TERMINAL_ID: T1 }
      ),
      recordState(
        stateDir,
        { session_id: SID2, cwd: CWD, hook_event_name: 'PermissionRequest' },
        { COMMAND_CENTER_TERMINAL_ID: T2 }
      ),
    ])
    await watcher.pollStateDir()
    expect(emitted()).toEqual(
      expect.arrayContaining([
        [T1, 'done'],
        [T2, 'permission'],
      ])
    )
  })

  test('an unchanged file is not processed again; a rewritten one is', async () => {
    writeEntry(`${SID}.json`, entry({ timestamp: 1000 }))
    await watcher.pollStateDir()
    await watcher.pollStateDir()
    expect(emitted()).toEqual([[T1, 'busy']])

    writeEntry(`${SID}.json`, entry({ state: 'done', hook_event: 'Stop', timestamp: 2000 }))
    // Make sure the mtime differs even on coarse-resolution filesystems
    utimesSync(join(stateDir, `${SID}.json`), new Date(), new Date(Date.now() + 5000))
    await watcher.pollStateDir()
    expect(emitted()).toEqual([
      [T1, 'busy'],
      [T1, 'done'],
    ])
  })

  test('stale session files are deleted and ignored', async () => {
    const file = join(stateDir, `${SID}.json`)
    writeEntry(`${SID}.json`, entry())
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    utimesSync(file, old, old)
    await watcher.pollStateDir()
    expect(existsSync(file)).toBe(false)
    expect(emitted()).toEqual([])
  })

  test('the stale sweep also forgets the session, so an ending owner never reverts to it', async () => {
    const now = Date.now()
    const bump = (name: string, offsetMs: number) => {
      const t = new Date(Date.now() + offsetMs)
      utimesSync(join(stateDir, name), t, t)
    }
    writeEntry(`${SID2}.json`, entry({ session_id: SID2, timestamp: now }))
    await watcher.pollStateDir() // SID2 owns T1, busy and recent
    writeEntry(`${SID}.json`, entry({ state: 'question', timestamp: now + 10 }))
    await watcher.pollStateDir() // SID tracked on T1, not emitted
    expect(watcher.getTerminalSessions()).toEqual([{ terminalId: T1, sessionId: SID2 }])

    bump(`${SID}.json`, -2 * 60 * 60 * 1000)
    await watcher.pollStateDir() // sweep deletes SID's file
    expect(existsSync(join(stateDir, `${SID}.json`))).toBe(false)

    writeEntry(
      `${SID2}.json`,
      entry({ session_id: SID2, state: 'stopped', hook_event: 'SessionEnd', timestamp: now + 20 })
    )
    bump(`${SID2}.json`, 5000)
    await watcher.pollStateDir()
    expect(emitted()).toEqual([
      [T1, 'busy'],
      [T1, 'stopped'],
    ])
    expect(watcher.getTerminalSessions()).toEqual([])
  })

  test('in-flight temp files and entries whose name does not match the session are ignored', async () => {
    writeEntry(`${SID}.json.123.abc.tmp`, entry())
    writeEntry(`${SID2}.json`, entry()) // claims SID inside SID2's file
    await watcher.pollStateDir()
    expect(emitted()).toEqual([])
  })

  test('SessionEnd removes the session file', async () => {
    writeEntry(`${SID}.json`, entry({ timestamp: 1000 }))
    await watcher.pollStateDir()
    writeEntry(
      `${SID}.json`,
      entry({ state: 'stopped', hook_event: 'SessionEnd', timestamp: 2000 })
    )
    utimesSync(join(stateDir, `${SID}.json`), new Date(), new Date(Date.now() + 5000))
    await watcher.pollStateDir()
    expect(emitted().at(-1)).toEqual([T1, 'stopped'])
    expect(existsSync(join(stateDir, `${SID}.json`))).toBe(false)
  })

  test('legacy shared file (Codex hook / older Claude hook) still routes by cwd', async () => {
    writeFileSync(
      join(claudeDir, LEGACY_STATE_FILE_NAME),
      JSON.stringify({
        [SID]: {
          session_id: SID,
          cwd: CWD,
          state: 'busy',
          timestamp: 1000,
          hook_event: 'SessionStart',
        },
      })
    )
    await (watcher as unknown as { onStateChange(): Promise<void> }).onStateChange()
    expect(emitted()).toEqual([[T1, 'busy']])
    expect(watcher.getTerminalSessions()).toEqual([{ terminalId: T1, sessionId: SID }])
  })

  test('missing state directory is not an error', async () => {
    rmSync(stateDir, { recursive: true, force: true })
    await expect(watcher.pollStateDir()).resolves.toBeUndefined()
  })
})
