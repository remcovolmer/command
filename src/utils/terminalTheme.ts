import type { ITheme, ITerminalOptions } from '@xterm/xterm'

/**
 * Resolve a CSS custom property to a hex color xterm.js can consume.
 *
 * xterm's ITheme wants concrete colors, not `var(...)` references, so tokens
 * defined as oklch()/color-mix() in index.css must be resolved through the
 * DOM. Exported (rather than kept module-private) so it can be unit-tested
 * directly and reused by other integrations (e.g. Monaco theme building).
 */
let scratchCtx: CanvasRenderingContext2D | null | undefined

/**
 * Paint a CSS color onto a 1×1 canvas and read the pixel back. Chromium
 * serializes computed oklch()/color-mix() colors as `oklch(...)` (not rgb), so
 * regex parsing alone cannot turn tokens into the hex that Monaco and xterm's
 * ITheme want. Returns null where canvas is unavailable (jsdom).
 */
function canvasToHex(value: string): string | null {
  if (scratchCtx === undefined) {
    try {
      scratchCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    } catch {
      scratchCtx = null
    }
  }
  const ctx = scratchCtx
  if (!ctx) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000000'
  ctx.fillStyle = value
  // An unparsable color leaves fillStyle untouched — treat that as failure
  // unless the caller really asked for black.
  if (ctx.fillStyle === '#000000' && !/^(#000000|#000|black|rgb\(0,\s*0,\s*0\))$/i.test(value)) {
    return null
  }
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export function getCssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // Undefined token: return '' so callers can omit the slot instead of
  // painting whatever the temp element's default color resolves to.
  if (!value) return ''
  // If it's already hex, return it
  if (value.startsWith('#')) return value
  const viaCanvas = canvasToHex(value)
  if (viaCanvas) return viaCanvas
  // Fallback (jsdom): resolve through a temp element and parse rgb()/rgba().
  const temp = document.createElement('div')
  temp.style.color = value
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)
  const match = computed.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/)
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0')
    const g = parseInt(match[2]).toString(16).padStart(2, '0')
    const b = parseInt(match[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return value
}

// The 16-color ANSI palette lives in src/index.css as --ansi-* tokens (one
// set per theme, next to the other surface tokens) so a token tweak or a third
// theme reaches the terminal too. Names are the xterm ITheme keys.
const ANSI_KEYS = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
] as const
type AnsiKey = (typeof ANSI_KEYS)[number]

const toCssVar = (key: AnsiKey) => `--ansi-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

function readAnsiPalette(): Partial<Record<AnsiKey, string>> {
  const out: Partial<Record<AnsiKey, string>> = {}
  for (const key of ANSI_KEYS) {
    const value = getCssVar(toCssVar(key))
    if (value) out[key] = value
  }
  return out
}

let cachedTheme: ITheme | null = null
let cachedThemeKey: string | null = null

/** Build terminal theme from CSS variables. Cached per app theme. */
export function buildTerminalTheme(appTheme?: string): ITheme {
  const key = appTheme ?? 'default'
  if (cachedTheme && cachedThemeKey === key) return cachedTheme

  const ansi = readAnsiPalette()

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
