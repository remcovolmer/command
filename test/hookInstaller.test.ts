import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
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

// HookInstaller resolves the script path via electron's app.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'C:/fake/app' },
}))

import {
  installClaudeHooks,
  installCodexHooks,
  uninstallCodexHooks,
  installOpencodePluginFromSource,
  uninstallOpencodePluginFromHome,
  OPENCODE_PLUGIN_FILENAME,
} from '../electron/main/services/HookInstaller'

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
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop']) {
      const entries = config.hooks?.[event] ?? []
      const ours = entries.flatMap((e) => e.hooks).filter((h) => h.command.includes('codex-state-hook'))
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
})

describe('HookInstaller (opencode plugin file-drop)', () => {
  let fakeHome: string
  const SOURCE_V1 =
    '// command-center-state-plugin — managed by Command\n// v1\n'
  const SOURCE_V2 =
    '// command-center-state-plugin — managed by Command\n// v2\n'

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'hook-installer-opencode-'))
    ;(globalThis as Record<string, string>).__TEST_HOMEDIR__ = fakeHome
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    delete (globalThis as Record<string, string>).__TEST_HOMEDIR__
  })

  const pluginPath = () => join(fakeHome, '.config', 'opencode', 'plugins', OPENCODE_PLUGIN_FILENAME)

  test('install drops the plugin file with exact content', () => {
    expect(installOpencodePluginFromSource(SOURCE_V1, fakeHome)).toBe('installed')
    expect(readFileSync(pluginPath(), 'utf-8')).toBe(SOURCE_V1)
  })

  test('install is idempotent — same content is up-to-date', () => {
    expect(installOpencodePluginFromSource(SOURCE_V1, fakeHome)).toBe('installed')
    expect(installOpencodePluginFromSource(SOURCE_V1, fakeHome)).toBe('up-to-date')
  })

  test('install overwrites our own stale copy on update', () => {
    installOpencodePluginFromSource(SOURCE_V1, fakeHome)
    expect(installOpencodePluginFromSource(SOURCE_V2, fakeHome)).toBe('installed')
    expect(readFileSync(pluginPath(), 'utf-8')).toBe(SOURCE_V2)
  })

  test('install never clobbers a foreign file with the same name', () => {
    mkdirSync(join(fakeHome, '.config', 'opencode', 'plugins'), { recursive: true })
    writeFileSync(pluginPath(), '// some other plugin\n')
    expect(installOpencodePluginFromSource(SOURCE_V1, fakeHome)).toBe('skipped-foreign')
    expect(readFileSync(pluginPath(), 'utf-8')).toBe('// some other plugin\n')
  })

  test('uninstall removes our plugin and reports true', () => {
    installOpencodePluginFromSource(SOURCE_V1, fakeHome)
    expect(uninstallOpencodePluginFromHome(fakeHome)).toBe(true)
    expect(existsSync(pluginPath())).toBe(false)
  })

  test('uninstall keeps foreign files and reports false', () => {
    mkdirSync(join(fakeHome, '.config', 'opencode', 'plugins'), { recursive: true })
    writeFileSync(pluginPath(), '// some other plugin\n')
    expect(uninstallOpencodePluginFromHome(fakeHome)).toBe(false)
    expect(readFileSync(pluginPath(), 'utf-8')).toBe('// some other plugin\n')
  })

  test('uninstall on a missing file reports false', () => {
    expect(uninstallOpencodePluginFromHome(fakeHome)).toBe(false)
  })
})
