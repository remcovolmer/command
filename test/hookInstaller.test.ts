import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  lstatSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Redirect ~ to a temp dir so we never touch the real ~/.claude or ~/.codex.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    homedir: () => (globalThis as Record<string, string>).__TEST_HOMEDIR__ ?? actual.homedir(),
  }
})

// Real fs, with renameSync wrapped so tests can inject Windows EPERM failures.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    realpathSync: vi.fn(actual.realpathSync),
  }
})

// HookInstaller resolves the script path via electron's app.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'C:/fake/app' },
}))

import {
  installClaudeHooks,
  installCodexHooks,
  uninstallCodexHooks,
  uninstallClaudeHooks,
  writeFileAtomicSync,
} from '../electron/main/services/HookInstaller'
import { renameSync, realpathSync, readdirSync, statSync } from 'fs'

interface HookConfig {
  hooks?: Record<string, Array<{ hooks: Array<{ command: string; async?: boolean }> }>>
  [key: string]: unknown
}

describe('HookInstaller (per-agent, generalized)', () => {
  let fakeHome: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'hook-installer-home-'))
    ;(globalThis as Record<string, string>).__TEST_HOMEDIR__ = fakeHome
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    delete (globalThis as Record<string, string>).__TEST_HOMEDIR__
  })

  const codexHooksPath = () => join(fakeHome, '.codex', 'hooks.json')
  const claudeSettingsPath = () => join(fakeHome, '.claude', 'settings.json')
  const readJson = (p: string): HookConfig => JSON.parse(readFileSync(p, 'utf-8'))

  test('installCodexHooks creates ~/.codex/hooks.json with the codex hook for each event', () => {
    installCodexHooks()
    expect(existsSync(codexHooksPath())).toBe(true)
    const config = readJson(codexHooksPath())
    for (const event of [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'Stop',
    ]) {
      const entries = config.hooks?.[event] ?? []
      const ours = entries
        .flatMap((e) => e.hooks)
        .filter((h) => h.command.includes('codex-state-hook'))
      expect(ours.length).toBe(1)
      // Codex skips async hooks, so the entry must NOT be async.
      expect(ours[0].async).toBeUndefined()
    }
  })

  test('re-installing migrates a stale async:true codex entry to synchronous', () => {
    // Simulate the earlier buggy install that set async: true.
    mkdirSync(join(fakeHome, '.codex'), { recursive: true })
    writeFileSync(
      codexHooksPath(),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node "x/codex-state-hook.cjs"',
                  async: true,
                  timeout: 5,
                },
              ],
            },
          ],
        },
      })
    )

    installCodexHooks()

    const stop = (readJson(codexHooksPath()).hooks?.Stop ?? [])
      .flatMap((e) => e.hooks)
      .filter((h) => h.command.includes('codex-state-hook'))
    expect(stop).toHaveLength(1)
    expect(stop[0].async).toBeUndefined()
  })

  test('installCodexHooks is idempotent — a second run adds no duplicates', () => {
    installCodexHooks()
    installCodexHooks()
    const config = readJson(codexHooksPath())
    const preToolUse = (config.hooks?.PreToolUse ?? [])
      .flatMap((e) => e.hooks)
      .filter((h) => h.command.includes('codex-state-hook'))
    expect(preToolUse.length).toBe(1)
  })

  test('uninstallCodexHooks removes only our entries', () => {
    installCodexHooks()
    uninstallCodexHooks()
    const config = existsSync(codexHooksPath()) ? readJson(codexHooksPath()) : {}
    const remaining = Object.values(config.hooks ?? {})
      .flat()
      .flatMap((e) => e.hooks)
      .filter((h) => h.command.includes('codex-state-hook'))
    expect(remaining.length).toBe(0)
  })

  test('installClaudeHooks preserves unrelated settings keys and foreign hooks', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true })
    writeFileSync(
      claudeSettingsPath(),
      JSON.stringify({
        model: 'opus',
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'someone-elses-hook.js' }] }] },
      })
    )

    installClaudeHooks()

    const config = readJson(claudeSettingsPath())
    expect(config.model).toBe('opus')
    const preToolUse = (config.hooks?.PreToolUse ?? []).flatMap((e) => e.hooks)
    expect(preToolUse.some((h) => h.command.includes('someone-elses-hook'))).toBe(true)
    expect(preToolUse.some((h) => h.command.includes('claude-state-hook'))).toBe(true)
    // Claude supports async hooks and must keep async: true.
    expect(preToolUse.find((h) => h.command.includes('claude-state-hook'))?.async).toBe(true)
  })

  const ourClaudeHook = (config: HookConfig, event: string) =>
    (config.hooks?.[event] ?? [])
      .flatMap((e) => e.hooks)
      .filter((h) => h.command.includes('claude-state-hook'))

  test('installClaudeHooks registers the new events; SessionEnd runs synchronously', () => {
    expect(installClaudeHooks()).toBe(true)
    const config = readJson(claudeSettingsPath())
    for (const event of ['PostToolUse', 'PostToolUseFailure', 'StopFailure']) {
      const ours = ourClaudeHook(config, event)
      expect(ours).toHaveLength(1)
      expect(ours[0].async).toBe(true)
    }
    const sessionEnd = ourClaudeHook(config, 'SessionEnd')
    expect(sessionEnd).toHaveLength(1)
    // Background hooks can be torn down with the exiting CLI before they write.
    expect(sessionEnd[0].async).toBeUndefined()
  })

  test('re-installing migrates an old async SessionEnd entry to synchronous', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true })
    writeFileSync(
      claudeSettingsPath(),
      JSON.stringify({
        hooks: {
          SessionEnd: [
            {
              hooks: [
                { type: 'command', command: 'node "C:/old/claude-state-hook.cjs"', async: true },
              ],
            },
          ],
        },
      })
    )
    installClaudeHooks()
    const sessionEnd = ourClaudeHook(readJson(claudeSettingsPath()), 'SessionEnd')
    expect(sessionEnd).toHaveLength(1)
    expect(sessionEnd[0].async).toBeUndefined()
    expect(sessionEnd[0].command).not.toContain('C:/old')
  })

  test.each([
    ['trailing comma', '{ "model": "opus", }'],
    ['truncated mid-write', '{ "model": "opus", "hooks": { "Stop": ['],
    ['JSON that is not an object', '[1, 2, 3]'],
  ])(
    'unparseable settings.json (%s) is left byte-identical and nothing is installed',
    (_label, raw) => {
      mkdirSync(join(fakeHome, '.claude'), { recursive: true })
      writeFileSync(claudeSettingsPath(), raw)
      vi.mocked(renameSync).mockClear()

      expect(installClaudeHooks()).toBe(false)
      uninstallClaudeHooks()

      expect(readFileSync(claudeSettingsPath(), 'utf-8')).toBe(raw)
      expect(renameSync).not.toHaveBeenCalled()
      expect(readdirSync(join(fakeHome, '.claude'))).toEqual(['settings.json'])
    }
  )

  test('a second install with nothing to change does not rewrite the file', () => {
    installClaudeHooks()
    const before = readFileSync(claudeSettingsPath(), 'utf-8')
    const mtimeBefore = statSync(claudeSettingsPath()).mtimeMs
    vi.mocked(renameSync).mockClear()

    expect(installClaudeHooks()).toBe(true)

    expect(renameSync).not.toHaveBeenCalled()
    expect(readFileSync(claudeSettingsPath(), 'utf-8')).toBe(before)
    expect(statSync(claudeSettingsPath()).mtimeMs).toBe(mtimeBefore)
  })

  test('install writes via a unique temp file + rename and leaves no temp behind', () => {
    vi.mocked(renameSync).mockClear()
    installClaudeHooks()
    expect(renameSync).toHaveBeenCalledTimes(1)
    const [from, to] = vi.mocked(renameSync).mock.calls[0]
    expect(String(to)).toBe(claudeSettingsPath())
    expect(String(from)).toMatch(/settings\.json\.\d+\.[0-9a-f-]{36}\.tmp$/)
    expect(readdirSync(join(fakeHome, '.claude'))).toEqual(['settings.json'])
  })

  test('writeFileAtomicSync retries a Windows EPERM/EBUSY rename, then succeeds', () => {
    const target = join(fakeHome, 'f.json')
    writeFileSync(target, 'old')
    const busy = (code: string) => Object.assign(new Error(code), { code })
    vi.mocked(renameSync)
      .mockImplementationOnce(() => {
        throw busy('EPERM')
      })
      .mockImplementationOnce(() => {
        throw busy('EBUSY')
      })

    writeFileAtomicSync(target, 'new')

    expect(readFileSync(target, 'utf-8')).toBe('new')
    expect(readdirSync(fakeHome)).toEqual(['f.json'])
  })

  test('writeFileAtomicSync gives up on a non-retryable error, keeps the original, removes the temp', () => {
    const target = join(fakeHome, 'f.json')
    writeFileSync(target, 'old')
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('nope'), { code: 'EXDEV' })
    })

    expect(() => writeFileAtomicSync(target, 'new')).toThrow('nope')

    expect(readFileSync(target, 'utf-8')).toBe('old')
    expect(readdirSync(fakeHome)).toEqual(['f.json'])
  })

  test('writeFileAtomicSync writes through a symlinked target and keeps the link', (ctx) => {
    // Dotfiles setups symlink settings.json into a repo elsewhere.
    const dotfiles = mkdtempSync(join(tmpdir(), 'hook-installer-dotfiles-'))
    try {
      const realFile = join(dotfiles, 'settings.json')
      writeFileSync(realFile, 'old')
      const link = join(fakeHome, 'settings.json')
      try {
        symlinkSync(realFile, link, 'file')
      } catch (e) {
        // Windows without Developer Mode / admin cannot create file symlinks.
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip()
        throw e
      }

      writeFileAtomicSync(link, 'new')

      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      expect(readFileSync(realFile, 'utf-8')).toBe('new')
      expect(readdirSync(dotfiles)).toEqual(['settings.json'])
      expect(readdirSync(fakeHome)).toEqual(['settings.json'])
    } finally {
      rmSync(dotfiles, { recursive: true, force: true })
    }
  })

  // Runs without symlink privileges: proves temp + rename land on the resolved path.
  test('writeFileAtomicSync places the temp next to, and renames onto, the resolved target', () => {
    const realDir = mkdtempSync(join(tmpdir(), 'hook-installer-real-'))
    try {
      const realFile = join(realDir, 'settings.json')
      writeFileSync(realFile, 'old')
      const linkPath = join(fakeHome, 'settings.json')
      vi.mocked(realpathSync).mockImplementationOnce(() => realFile)
      vi.mocked(renameSync).mockClear()

      writeFileAtomicSync(linkPath, 'new')

      const [from, to] = vi.mocked(renameSync).mock.calls[0]
      expect(String(to)).toBe(realFile)
      expect(String(from).startsWith(`${realFile}.`)).toBe(true)
      expect(readFileSync(realFile, 'utf-8')).toBe('new')
      expect(existsSync(linkPath)).toBe(false)
    } finally {
      rmSync(realDir, { recursive: true, force: true })
    }
  })

  test('writeFileAtomicSync creates a missing target (nothing to resolve)', () => {
    const target = join(fakeHome, 'new.json')

    writeFileAtomicSync(target, 'fresh')

    expect(readFileSync(target, 'utf-8')).toBe('fresh')
    expect(readdirSync(fakeHome)).toEqual(['new.json'])
  })
})
