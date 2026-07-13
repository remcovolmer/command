import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
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
    events: [
      'PreToolUse',
      'Stop',
      'Notification',
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PermissionRequest',
    ],
    matchToken: 'claude-state-hook',
    async: true,
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

/**
 * Install one agent's hooks into its config file, idempotently. Reads the
 * existing JSON (preserving unrelated keys), adds or migrates our hook entry for
 * each event, and writes back only if something changed.
 */
function installTarget(target: AgentHookTarget): void {
  const { label, configPath, scriptName, events, matchToken, async: useAsync } = target
  const hookScriptPath = getHookScriptPath(scriptName)
  const configDir = dirname(configPath)

  log.info(`Installing ${label} hooks...`)
  log.debug('Hook script path:', hookScriptPath)

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  let config: HookConfig = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (e) {
      log.warn(`Failed to parse existing ${label} config, creating new`)
      config = {}
    }
  }

  config.hooks = config.hooks || {}

  const hookCommand: { type: string; command: string; timeout: number; async?: boolean } = {
    type: 'command',
    command: `node "${normalizePath(hookScriptPath)}"`,
    timeout: 5,
  }
  // Only emit async when the agent supports it (Claude yes, Codex no).
  if (useAsync) hookCommand.async = true
  const ourHook = { hooks: [hookCommand] }

  let changed = false
  for (const event of events) {
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
        (Boolean(hookEntry.async) !== useAsync || hookEntry.command !== ourHook.hooks[0].command)
      ) {
        config.hooks[event][existingIdx] = ourHook
        changed = true
        log.info(`Migrated ${label} hook for ${event} (async: ${useAsync})`)
      }
    }
  }

  if (changed) {
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2))
      log.info(`${label} hooks installed/updated successfully`)
      log.info(`Note: Restart ${label} for hooks to take effect`)
    } catch (e) {
      log.error(`Failed to write ${label} hooks:`, e)
    }
  } else {
    log.info(`${label} hooks already up to date`)
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

  try {
    const config: HookConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!config.hooks) {
      return
    }

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

    writeFileSync(configPath, JSON.stringify(config, null, 2))
    log.info(`${label} hooks uninstalled successfully`)
  } catch (e) {
    log.error(`Failed to uninstall ${label} hooks:`, e)
  }
}

/** Install Claude Code hooks for Command state detection. */
export function installClaudeHooks(): void {
  installTarget(claudeTarget())
}

/** Remove Command hooks from Claude settings. */
export function uninstallClaudeHooks(): void {
  uninstallTarget(claudeTarget())
}

/** Install Codex hooks for Command state detection (~/.codex/hooks.json). */
export function installCodexHooks(): void {
  installTarget(codexTarget())
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
