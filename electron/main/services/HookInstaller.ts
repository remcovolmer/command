import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { app } from 'electron'
import { normalizePath } from '../utils/paths'
import { createLogger } from './Logger'

const log = createLogger('HookInstaller')

interface HookConfig {
  hooks?: {
    [event: string]: Array<{
      matcher?: string
      hooks: Array<{
        type: string
        command: string
        async?: boolean
        timeout?: number
      }>
    }>
  }
  [key: string]: unknown
}

/**
 * A per-agent hook install target. Claude and Codex share the same hook config
 * shape ({ hooks: { Event: [{ hooks: [{ type, command }] }] } }) and the same
 * stdin-JSON contract, so one installer serves both — only the config file,
 * script, and event list differ. Adding another hook-capable agent = add a
 * target here.
 */
interface AgentHookTarget {
  label: string
  /** Absolute path to the JSON config file to merge our hooks into. */
  configPath: string
  /** Hook script filename in electron/main/hooks (dev) / resources/hooks (prod). */
  scriptName: string
  /** Events to register the hook for. */
  events: string[]
  /** Substring identifying our hook entry, for idempotent add/migrate/remove. */
  matchToken: string
  /**
   * Emit `async: true` on the hook entry. Claude runs async hooks; Codex does
   * NOT ("async hooks are not supported yet" — it silently skips them), so codex
   * hooks must be synchronous or they never fire.
   */
  async: boolean
  /**
   * Events that must run synchronously even when `async` is true. SessionEnd
   * fires while the agent exits; a background hook can be torn down with the
   * process before it writes, losing the "session ended" signal.
   */
  syncEvents?: string[]
}

/**
 * Resolve a hook script path.
 * Dev: electron/main/hooks/<script>. Prod: resources/hooks/<script> (see
 * electron-builder.json extraResources, which ships every hooks/*.cjs).
 */
function getHookScriptPath(scriptName: string): string {
  const isDev = !app.isPackaged
  if (isDev) {
    return join(app.getAppPath(), 'electron', 'main', 'hooks', scriptName)
  }
  return join(process.resourcesPath, 'hooks', scriptName)
}

function claudeTarget(): AgentHookTarget {
  return {
    label: 'Claude',
    configPath: join(homedir(), '.claude', 'settings.json'),
    scriptName: 'claude-state-hook.cjs',
    // Claude fires all of these; Notification/SessionEnd are Claude-specific.
    // PostToolUse(Failure) clear 'permission' once an approved tool has run;
    // StopFailure ends a turn on an API error (Stop does not fire then).
    events: [
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'StopFailure',
      'Notification',
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PermissionRequest',
    ],
    matchToken: 'claude-state-hook',
    async: true,
    syncEvents: ['SessionEnd'],
  }
}

function codexTarget(): AgentHookTarget {
  return {
    label: 'Codex',
    // Dedicated hooks.json — never touches the user's config.toml (mcp/notify/etc.).
    configPath: join(homedir(), '.codex', 'hooks.json'),
    scriptName: 'codex-state-hook.cjs',
    // The subset Codex actually fires that maps to a Command state.
    events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop'],
    matchToken: 'codex-state-hook',
    // Codex skips async hooks — must be synchronous to fire at all.
    async: false,
  }
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRIES = 5
const RETRY_DELAY_MS = 50
const PARSE_RETRY_DELAY_MS = 150

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function errorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code
  return undefined
}

/**
 * Write a file atomically: unique temp file in the same directory, then rename
 * over the target. The agent CLI reads (and rewrites) this config itself, so an
 * in-place write could be observed half-written. Windows rename fails with
 * EPERM/EBUSY while another process has the target open — retry briefly.
 * Exported for testing.
 */
export function writeFileAtomicSync(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, content)
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tempPath, filePath)
      return
    } catch (e) {
      const code = errorCode(e)
      if (attempt < RENAME_RETRIES && code !== undefined && RENAME_RETRY_CODES.has(code)) {
        sleepSync(RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      try {
        unlinkSync(tempPath)
      } catch {
        /* best-effort temp cleanup */
      }
      throw e
    }
  }
}

type ReadConfigResult = { ok: true; config: HookConfig; raw: string | null } | { ok: false }

/**
 * Read and parse an existing JSON config. A missing file is an empty config; a
 * file that does not parse is NOT — it may be mid-write by the agent or carry a
 * user typo, and treating it as `{}` would overwrite every user setting. Retries
 * once (mid-write case), then reports failure so the caller writes nothing.
 */
function readConfig(label: string, configPath: string): ReadConfigResult {
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string
    try {
      raw = readFileSync(configPath, 'utf-8')
    } catch (e) {
      if (errorCode(e) === 'ENOENT') return { ok: true, config: {}, raw: null }
      log.error(`Cannot read ${label} config ${configPath}; hooks not changed:`, e)
      return { ok: false }
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, config: parsed as HookConfig, raw }
      }
    } catch {
      /* fall through to retry / failure */
    }
    if (attempt === 0) sleepSync(PARSE_RETRY_DELAY_MS)
  }
  log.error(
    `${label} config ${configPath} is not valid JSON; leaving it untouched and skipping hook ` +
      `changes (state detection stays off until the file is fixed and Command restarts)`
  )
  return { ok: false }
}

/**
 * Install one agent's hooks into its config file, idempotently. Reads the
 * existing JSON (preserving unrelated keys), adds or migrates our hook entry for
 * each event, and writes back (atomically) only if something changed. Returns
 * false when the config could not be parsed or written.
 */
function installTarget(target: AgentHookTarget): boolean {
  const { label, configPath, scriptName, events, matchToken, async: useAsync } = target
  const hookScriptPath = getHookScriptPath(scriptName)
  const configDir = dirname(configPath)

  log.info(`Installing ${label} hooks...`)
  log.debug('Hook script path:', hookScriptPath)

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  const read = readConfig(label, configPath)
  if (!read.ok) return false
  const config = read.config

  config.hooks = config.hooks || {}

  let changed = false
  for (const event of events) {
    // Only emit async when the agent supports it (Claude yes, Codex no) and the
    // event need not finish before the agent exits (see syncEvents).
    const eventAsync = useAsync && !target.syncEvents?.includes(event)
    const hookCommand: { type: string; command: string; timeout: number; async?: boolean } = {
      type: 'command',
      command: `node "${normalizePath(hookScriptPath)}"`,
      timeout: 5,
    }
    if (eventAsync) hookCommand.async = true
    const ourHook = { hooks: [hookCommand] }

    config.hooks[event] = config.hooks[event] || []

    const existingIdx = config.hooks[event].findIndex((h) =>
      h.hooks?.some((hh) => hh.command?.includes(matchToken))
    )

    if (existingIdx === -1) {
      config.hooks[event].push(ourHook)
      changed = true
      log.info(`Added ${label} hook for ${event}`)
    } else {
      const existing = config.hooks[event][existingIdx]
      const hookEntry = existing.hooks?.find((hh) => hh.command?.includes(matchToken))
      // Re-install when the command path drifted or the async flag no longer
      // matches what this agent needs (migrates the old async:true codex entry).
      if (
        hookEntry &&
        (Boolean(hookEntry.async) !== eventAsync || hookEntry.command !== hookCommand.command)
      ) {
        config.hooks[event][existingIdx] = ourHook
        changed = true
        log.info(`Migrated ${label} hook for ${event} (async: ${eventAsync})`)
      }
    }
  }

  if (!changed) {
    log.info(`${label} hooks already up to date`)
    return true
  }
  try {
    writeFileAtomicSync(configPath, JSON.stringify(config, null, 2))
    log.info(`${label} hooks installed/updated successfully`)
    log.info(`Note: Restart ${label} for hooks to take effect`)
    return true
  } catch (e) {
    log.error(`Failed to write ${label} hooks:`, e)
    return false
  }
}

/**
 * Remove one agent's hooks from its config file, leaving unrelated entries and
 * top-level keys intact.
 */
function uninstallTarget(target: AgentHookTarget): void {
  const { label, configPath, matchToken } = target
  if (!existsSync(configPath)) {
    return
  }

  const read = readConfig(label, configPath)
  if (!read.ok) return
  const config = read.config
  if (!config.hooks) {
    return
  }
  try {
    for (const event of Object.keys(config.hooks)) {
      config.hooks[event] = config.hooks[event].filter(
        (h) => !h.hooks?.some((hh) => hh.command?.includes(matchToken))
      )
      if (config.hooks[event].length === 0) {
        delete config.hooks[event]
      }
    }

    if (Object.keys(config.hooks).length === 0) {
      delete config.hooks
    }

    writeFileAtomicSync(configPath, JSON.stringify(config, null, 2))
    log.info(`${label} hooks uninstalled successfully`)
  } catch (e) {
    log.error(`Failed to uninstall ${label} hooks:`, e)
  }
}

/** Install Claude Code hooks for Command state detection. False on failure. */
export function installClaudeHooks(): boolean {
  return installTarget(claudeTarget())
}

/** Remove Command hooks from Claude settings. */
export function uninstallClaudeHooks(): void {
  uninstallTarget(claudeTarget())
}

/** Install Codex hooks for Command state detection (~/.codex/hooks.json). */
export function installCodexHooks(): boolean {
  return installTarget(codexTarget())
}

/** Remove Command hooks from the Codex hooks config. */
export function uninstallCodexHooks(): void {
  uninstallTarget(codexTarget())
}

/** Install hooks for every hook-capable agent. */
export function installAgentHooks(): void {
  installClaudeHooks()
  installCodexHooks()
}
