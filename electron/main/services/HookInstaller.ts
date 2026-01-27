import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'

interface ClaudeSettings {
  hooks?: {
    [event: string]: Array<{
      matcher?: string
      hooks: Array<{
        type: string
        command: string
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
    // In production, the script should be in the app resources
    return join(process.resourcesPath, 'app', 'electron', 'main', 'hooks', 'claude-state-hook.cjs')
  }
}

/**
 * Install Claude Code hooks for Command Center state detection
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
      command: `node "${hookScriptPath.replace(/\\/g, '/')}"`
    }]
  }

  // Hook events we need to monitor
  const hookEvents = ['PreToolUse', 'Stop', 'Notification', 'SessionStart', 'SessionEnd']

  let installed = false
  for (const event of hookEvents) {
    settings.hooks[event] = settings.hooks[event] || []

    // Check if our hook is already installed
    const hasOurHook = settings.hooks[event].some(
      (h) => h.hooks?.some((hh) => hh.command?.includes('claude-state-hook'))
    )

    if (!hasOurHook) {
      settings.hooks[event].push(ourHook)
      installed = true
      console.log(`[HookInstaller] Added hook for ${event}`)
    }
  }

  if (installed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    console.log('[HookInstaller] Hooks installed successfully')
    console.log('[HookInstaller] Note: Restart Claude Code for hooks to take effect')
  } else {
    console.log('[HookInstaller] Hooks already installed')
  }
}

/**
 * Remove Command Center hooks from Claude settings
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
