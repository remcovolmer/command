/**
 * Estimate the xterm grid (cols x rows) a terminal will get *before* it exists,
 * so `terminal:create` can spawn the PTY at the real size. Without it a new or
 * resumed chat spawns at 80x24 and gets a resize burst on first fit (Claude
 * Code replays `--resume` at 80 columns). Undefined means "can't tell" — main
 * then falls back to the last applied size, then 80x24.
 *
 * Order: the live xterm of the given (active) terminal, which is exactly the
 * grid a new terminal in the same viewport gets; otherwise measure the viewport
 * container and divide by a measured monospace cell (same arithmetic as xterm's
 * renderer + FitAddon, see cellFromCharSize / gridFromViewport).
 */

// Bundled via @fontsource/ibm-plex-mono (see index.css); the rest is the
// fallback stack for a still-loading face or a stripped install.
export const TERMINAL_FONT_STACK =
  "'IBM Plex Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
export const TERMINAL_LINE_HEIGHT = 1.15
/** Mirrors `.terminal-container .xterm { padding }` in index.css. */
export const TERMINAL_PADDING_PX = 12

export type TerminalViewportKind = 'chat' | 'sidecar'

export interface GridSize {
  cols: number
  rows: number
}

export interface CellSize {
  width: number
  height: number
}

/** Font size per kind — mirrors Terminal.tsx (14) and SidecarTerminalPanel (13). */
const FONT_SIZE: Record<TerminalViewportKind, number> = { chat: 14, sidecar: 13 }

/**
 * CSS cell size from a measured character box, rounded like xterm's renderer:
 * device char width floored, char height ceiled, cell height = floor(char
 * height * lineHeight), all in device pixels, then back to CSS pixels.
 */
export function cellFromCharSize(
  charWidth: number,
  charHeight: number,
  lineHeight: number,
  dpr: number
): CellSize | undefined {
  if (!(charWidth > 0 && charHeight > 0 && lineHeight > 0 && dpr > 0)) return undefined
  const deviceWidth = Math.floor(charWidth * dpr)
  const deviceHeight = Math.floor(Math.ceil(charHeight * dpr) * lineHeight)
  if (deviceWidth <= 0 || deviceHeight <= 0) return undefined
  return { width: deviceWidth / dpr, height: deviceHeight / dpr }
}

/**
 * Grid that fits a viewport of `width` x `height` CSS px with `padding` on each
 * side (FitAddon semantics). Undefined for a hidden/collapsed/degenerate box.
 */
export function gridFromViewport(
  width: number,
  height: number,
  cell: CellSize,
  padding: number
): GridSize | undefined {
  if (!(cell.width > 0 && cell.height > 0)) return undefined
  const cols = Math.floor((width - 2 * padding) / cell.width)
  const rows = Math.floor((height - 2 * padding) / cell.height)
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 1) return undefined
  return { cols, rows }
}

// --- Live xterm registry -----------------------------------------------------

interface LiveGrid {
  kind: TerminalViewportKind
  grid: { readonly cols: number; readonly rows: number }
}

const liveGrids = new Map<string, LiveGrid>()

/** Called by useXtermInstance for every live xterm (pass the XTerm itself). */
export function registerLiveGrid(
  terminalId: string,
  kind: TerminalViewportKind,
  grid: { readonly cols: number; readonly rows: number }
): void {
  liveGrids.set(terminalId, { kind, grid })
}

export function unregisterLiveGrid(terminalId: string): void {
  liveGrids.delete(terminalId)
}

// --- DOM measurement ---------------------------------------------------------

/** Attribute value put on the element that hosts the terminals of a kind. */
export const VIEWPORT_ATTR = 'data-terminal-viewport'

let measureCanvas: HTMLCanvasElement | null = null

function measureCell(fontSize: number): CellSize | undefined {
  if (typeof document === 'undefined') return undefined
  measureCanvas ??= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return undefined
  ctx.font = `${fontSize}px ${TERMINAL_FONT_STACK}`
  // Same probe as xterm's TextMetricsMeasureStrategy: width of 'W', height
  // from the font bounding box.
  const metrics = ctx.measureText('W'.repeat(32))
  const charHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
  return cellFromCharSize(
    metrics.width / 32,
    charHeight,
    TERMINAL_LINE_HEIGHT,
    window.devicePixelRatio || 1
  )
}

/**
 * Best-effort grid for a new terminal of `kind`. `preferredTerminalId` is the
 * currently active terminal of that viewport (its live grid wins).
 */
export function estimateTerminalGrid(
  kind: TerminalViewportKind,
  preferredTerminalId?: string | null
): GridSize | undefined {
  const live = preferredTerminalId ? liveGrids.get(preferredTerminalId) : undefined
  if (live && live.kind === kind && live.grid.cols >= 2 && live.grid.rows >= 1) {
    return { cols: live.grid.cols, rows: live.grid.rows }
  }

  if (typeof document === 'undefined') return undefined
  const el = document.querySelector(`[${VIEWPORT_ATTR}="${kind}"]`)
  if (!el) return undefined
  const rect = el.getBoundingClientRect()
  const cell = measureCell(FONT_SIZE[kind])
  if (!cell) return undefined
  return gridFromViewport(rect.width, rect.height, cell, TERMINAL_PADDING_PX)
}

/**
 * Startup variant: waits (bounded) for the chat viewport to be laid out and the
 * terminal font to load, so sessions restored at launch spawn at the real size.
 */
export async function estimateChatGridWhenReady(timeoutMs = 1500): Promise<GridSize | undefined> {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') {
    return undefined
  }
  const deadline = Date.now() + timeoutMs
  try {
    await Promise.race([
      document.fonts.load(`${FONT_SIZE.chat}px 'IBM Plex Mono'`),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  } catch {
    // Font loading failed — measure with whatever face is available.
  }
  while (Date.now() < deadline) {
    const grid = estimateTerminalGrid('chat')
    if (grid) return grid
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  return estimateTerminalGrid('chat')
}
