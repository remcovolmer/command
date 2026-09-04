import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from './Logger'

const log = createLogger('uiState')

export type ResolvedTheme = 'light' | 'dark'

export interface UiState {
  resolvedTheme: ResolvedTheme
}

const DEFAULT_UI_STATE: UiState = { resolvedTheme: 'dark' }

// Hard-coded per theme (no CSS available this early in the main process).
// Mirrors the --canvas / --fg-muted tokens in src/index.css closely enough
// for the titlebar chrome; the renderer repaints the real surface on load.
export const TITLEBAR_COLORS: Record<ResolvedTheme, { color: string; symbolColor: string }> = {
  light: { color: '#f1efe9', symbolColor: '#4a4540' },
  dark: { color: '#2b2825', symbolColor: '#d9d3c8' },
}

function getUiStatePath(): string {
  return path.join(app.getPath('userData'), 'ui-state.json')
}

function isValidTheme(value: unknown): value is ResolvedTheme {
  return value === 'light' || value === 'dark'
}

/**
 * Synchronous read — called from `createWindow` before the BrowserWindow
 * exists, so the initial `backgroundColor` and `titleBarOverlay` match the
 * last-used theme on the very first paint (no flash of the wrong theme).
 * Falls back to the default state on a missing or corrupt file.
 */
export function readUiStateSync(): UiState {
  try {
    const raw = fs.readFileSync(getUiStatePath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      isValidTheme((parsed as Record<string, unknown>).resolvedTheme)
    ) {
      return { resolvedTheme: (parsed as Record<string, unknown>).resolvedTheme as ResolvedTheme }
    }
  } catch {
    // Missing or corrupt file — fall back to the default.
  }
  return { ...DEFAULT_UI_STATE }
}

/** Atomic write: temp file + rename, mirroring ProjectPersistence.saveState. */
export function writeUiState(state: UiState): void {
  try {
    const filePath = getUiStatePath()
    const dirPath = path.dirname(filePath)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    const tempPath = `${filePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    log.error('Failed to write ui-state.json:', error)
  }
}
