import type { ITheme } from '@xterm/xterm'

// Helper to get computed CSS variable value as hex
function getCssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // If it's already hex, return it
  if (value.startsWith('#')) return value
  // If it's oklch or other format, we need to convert it
  // Create a temporary element to compute the color
  const temp = document.createElement('div')
  temp.style.color = value
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)
  // Convert rgb(r, g, b) to hex
  const match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0')
    const g = parseInt(match[2]).toString(16).padStart(2, '0')
    const b = parseInt(match[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return value
}

let cachedTheme: ITheme | null = null
let cachedThemeKey: string | null = null

/** Build terminal theme from CSS variables. Cached per app theme. */
export function buildTerminalTheme(appTheme?: string): ITheme {
  const key = appTheme ?? 'default'
  if (cachedTheme && cachedThemeKey === key) return cachedTheme

  const bg = getCssVar('--sidebar')
  const fg = getCssVar('--sidebar-foreground')
  const primary = getCssVar('--primary')
  const muted = getCssVar('--muted-foreground')
  const accent = getCssVar('--sidebar-accent')

  cachedTheme = {
    background: bg,
    foreground: fg,
    cursor: primary,
    cursorAccent: bg,
    selectionBackground: accent,
    black: getCssVar('--background'),
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: fg,
    brightBlack: muted,
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#ffffff',
  }
  cachedThemeKey = key

  return cachedTheme
}

/** Invalidate theme cache (call on theme change) */
export function invalidateTerminalThemeCache() {
  cachedTheme = null
  cachedThemeKey = null
}
