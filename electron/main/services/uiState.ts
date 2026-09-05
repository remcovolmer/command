import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from './Logger'

const log = createLogger('uiState')

export type ResolvedTheme = 'light' | 'dark'

export interface TitlebarColors {
  color: string
  symbolColor: string
}

export interface UiState {
  resolvedTheme: ResolvedTheme
  /** Token-derived colors the renderer sent last; absent until the first sync. */
  titlebar?: TitlebarColors
}

const DEFAULT_UI_STATE: UiState = { resolvedTheme: 'dark' }

// Fallback per theme for the very first launch, before the renderer has ever
// resolved the real --canvas / --fg-muted tokens and sent them over
// app:set-titlebar-overlay (persisted in ui-state.json as `titlebar`).
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

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Runtime guard for renderer-supplied titlebar colors (IPC boundary). */
export function isTitlebarColors(value: unknown): value is TitlebarColors {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.color === 'string' &&
    HEX_COLOR.test(v.color) &&
    typeof v.symbolColor === 'string' &&
    HEX_COLOR.test(v.symbolColor)
  )
}

/** Colors to paint the window/overlay with: last synced tokens, else the fallback. */
export function resolveTitlebarColors(state: UiState): TitlebarColors {
  return state.titlebar ?? TITLEBAR_COLORS[state.resolvedTheme]
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
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (isValidTheme(record.resolvedTheme)) {
        const state: UiState = { resolvedTheme: record.resolvedTheme }
        if (isTitlebarColors(record.titlebar)) state.titlebar = record.titlebar
        return state
      }
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
