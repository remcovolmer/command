import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { normalizePath } from '../utils/paths'

interface ClaudeSettings {
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
 * Get the path to the hook script
 * In development: electron/main/hooks/claude-state-hook.js
 * In production: resources/app/electron/main/hooks/claude-state-hook.js
 */
function getHookScriptPath(): string {
  const isDev = !app.isPackaged

  if (isDev) {
    // In development, use the source directory
    return join(app.getAppPath(), 'electron', 'main', 'hooks', 'claude-state-hook.cjs')
  } else {
    // In production, the script is in extraResources/hooks/
    return join(process.resourcesPath, 'hooks', 'claude-state-hook.cjs')
  }
}

/**
 * Install Claude Code hooks for Command state detection
 *
 * This function adds hooks to the user's ~/.claude/settings.json
 * to enable state detection via the hook system.
 */
export function installClaudeHooks(): void {
  const claudeDir = join(homedir(), '.claude')
  const settingsPath = join(claudeDir, 'settings.json')
  const hookScriptPath = getHookScriptPath()

  console.log('[HookInstaller] Installing hooks...')
  console.log('[HookInstaller] Hook script path:', hookScriptPath)

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  // Read existing settings or create new
  let settings: ClaudeSettings = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch (e) {
      console.warn('[HookInstaller] Failed to parse existing settings, creating new')
      settings = {}
    }
  }

  // Initialize hooks object
  settings.hooks = settings.hooks || {}

  // Our hook configuration
  const ourHook = {
    hooks: [{
      type: 'command',
      command: `node "${normalizePath(hookScriptPath)}"`,
      async: true,
      timeout: 5
    }]
  }

  // Hook events we need to monitor
  const hookEvents = [
    'PreToolUse',
    'Stop',
    'Notification',
    'SessionStart',
    'UserPromptSubmit',
    'PermissionRequest'
  ]

  let changed = false
  for (const event of hookEvents) {
    settings.hooks[event] = settings.hooks[event] || []

    // Find existing hook entry
    const existingIdx = settings.hooks[event].findIndex(
      (h) => h.hooks?.some((hh) => hh.command?.includes('claude-state-hook'))
    )

    if (existingIdx === -1) {
      // Not installed yet — add it
      settings.hooks[event].push(ourHook)
      changed = true
      console.log(`[HookInstaller] Added hook for ${event}`)
    } else {
      // Already installed — migrate if missing async or command path changed
      const existing = settings.hooks[event][existingIdx]
      const hookEntry = existing.hooks?.find((hh) => hh.command?.includes('claude-state-hook'))
      if (hookEntry && (!hookEntry.async || hookEntry.command !== ourHook.hooks[0].command)) {
        settings.hooks[event][existingIdx] = ourHook
        changed = true
        console.log(`[HookInstaller] Migrated hook for ${event} (async: true)`)
      }
    }
  }

  if (changed) {
    try {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      console.log('[HookInstaller] Hooks installed/updated successfully')
      console.log('[HookInstaller] Note: Restart Claude Code for hooks to take effect')
    } catch (e) {
      console.error('[HookInstaller] Failed to write hooks:', e)
    }
  } else {
    console.log('[HookInstaller] Hooks already up to date')
  }
}

/**
 * Remove Command hooks from Claude settings
 */
export function uninstallClaudeHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json')

  if (!existsSync(settingsPath)) {
    return
  }

  try {
    const settings: ClaudeSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))

    if (!settings.hooks) {
      return
    }

    // Remove our hooks from each event
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter(
        (h) => !h.hooks?.some((hh) => hh.command?.includes('claude-state-hook'))
      )
      // Clean up empty arrays
      if (settings.hooks[event].length === 0) {
        delete settings.hooks[event]
      }
    }

    // Clean up empty hooks object
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    console.log('[HookInstaller] Hooks uninstalled successfully')
  } catch (e) {
    console.error('[HookInstaller] Failed to uninstall hooks:', e)
  }
}
