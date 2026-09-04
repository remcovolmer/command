import type { ITheme, ITerminalOptions } from '@xterm/xterm'

/**
 * Resolve a CSS custom property to a hex color xterm.js can consume.
 *
 * xterm's ITheme wants concrete colors, not `var(...)` references, so tokens
 * defined as oklch()/color-mix() in index.css must be resolved through the
 * DOM. Exported (rather than kept module-private) so it can be unit-tested
 * directly and reused by other integrations (e.g. Monaco theme building).
 */
export function getCssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // If it's already hex, return it
  if (value.startsWith('#')) return value
  // If it's oklch, color-mix or any other CSS color syntax, resolve it via a
  // temporary element — the browser computes it down to an rgb()/rgba() (or,
  // in some environments, leaves it unresolved; the passthrough below then
  // returns the original value rather than a broken color).
  const temp = document.createElement('div')
  temp.style.color = value
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)
  // Matches "rgb(r, g, b)", "rgba(r, g, b, a)" and the space-separated
  // "rgb(r g b / a)" syntax — comma or whitespace between channels, with an
  // optional "/ alpha" suffix that we ignore (xterm themes take opaque hex).
  const match = computed.match(
    /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+[\d.]+)?\s*\)/
  )
  if (match) {
    const r = parseInt(match[1], 10).toString(16).padStart(2, '0')
    const g = parseInt(match[2], 10).toString(16).padStart(2, '0')
    const b = parseInt(match[3], 10).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return value
}

// Two explicit ANSI palettes (warm-toned, one per app theme) replacing the
// former Tokyo Night pastels that shifted hue arbitrarily once
// minimumContrastRatio remapped them for light backgrounds. Bright variants
// are the same hue lightened toward white in sRGB (light: +8%, dark: +6%) —
// computed once and hard-coded rather than derived at runtime, since these
// are fixed design values, not theme-dependent.
const ANSI_LIGHT = {
  red: '#b83f36',
  green: '#4e7d2a',
  yellow: '#9a6a10',
  blue: '#2f5fb3',
  magenta: '#8748a8',
  cyan: '#217a82',
  brightRed: '#be4e46',
  brightGreen: '#5c873b',
  brightYellow: '#a27623',
  brightBlue: '#406cb9',
  brightMagenta: '#9157af',
  brightCyan: '#33858c',
}

const ANSI_DARK = {
  red: '#e06c6c',
  green: '#97c37a',
  yellow: '#e2b96a',
  blue: '#7fa8e0',
  magenta: '#c39ad8',
  cyan: '#7ccfd0',
  brightRed: '#e27575',
  brightGreen: '#9dc782',
  brightYellow: '#e4bd73',
  brightBlue: '#87ade2',
  brightMagenta: '#c7a0da',
  brightCyan: '#84d2d3',
}

let cachedTheme: ITheme | null = null
let cachedThemeKey: string | null = null

/** Build terminal theme from CSS variables. Cached per app theme. */
export function buildTerminalTheme(appTheme?: string): ITheme {
  const key = appTheme ?? 'default'
  if (cachedTheme && cachedThemeKey === key) return cachedTheme

  const ansi = appTheme === 'dark' ? ANSI_DARK : ANSI_LIGHT

  const bg = getCssVar('--screen')
  const fg = getCssVar('--fg')
  const primary = getCssVar('--primary')
  const canvas = getCssVar('--canvas')
  const faint = getCssVar('--fg-faint')
  const strong = getCssVar('--fg-strong')
  const selection = getCssVar('--terminal-selection')

  cachedTheme = {
    background: bg,
    foreground: fg,
    cursor: primary,
    cursorAccent: bg,
    selectionBackground: selection,
    black: canvas,
    red: ansi.red,
    green: ansi.green,
    yellow: ansi.yellow,
    blue: ansi.blue,
    magenta: ansi.magenta,
    cyan: ansi.cyan,
    white: fg,
    brightBlack: faint,
    brightRed: ansi.brightRed,
    brightGreen: ansi.brightGreen,
    brightYellow: ansi.brightYellow,
    brightBlue: ansi.brightBlue,
    brightMagenta: ansi.brightMagenta,
    brightCyan: ansi.brightCyan,
    brightWhite: strong,
  }
  cachedThemeKey = key

  return cachedTheme
}

/** Keep TUI colors readable when terminal applications use a dark-only palette. */
export function buildTerminalThemeOptions(
  appTheme?: string
): Pick<ITerminalOptions, 'theme' | 'minimumContrastRatio'> {
  return {
    theme: buildTerminalTheme(appTheme),
    minimumContrastRatio: 4.5,
  }
}

/** Invalidate theme cache (call on theme change) */
export function invalidateTerminalThemeCache() {
  cachedTheme = null
  cachedThemeKey = null
}
