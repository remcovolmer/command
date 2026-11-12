/**
 * Terminal mode state that @xterm/addon-serialize 0.14 does not serialize.
 *
 * The addon restores the mouse *tracking* mode (?1000/?1002/?1003) but never
 * the mouse *encoding* (?1006 SGR / ?1016 SGR-pixels) and never a hidden
 * cursor (?25l). After a restore, Claude Code (fullscreen, SGR mouse) would
 * receive DEFAULT-encoded reports it cannot parse — scrolling dies — and a
 * cursor it hid would reappear. We capture both at serialize time and append
 * the sequences that re-apply them to the serialized buffer.
 *
 * xterm 5.5 exposes neither through its public API, so this reads the core
 * services (`_core.coreMouseService.activeEncoding`,
 * `_core.coreService.isCursorHidden`). Unknown shapes degrade to defaults.
 */

export interface TerminalModeSnapshot {
  /** xterm mouse encoding name: 'DEFAULT' | 'SGR' | 'SGR_PIXELS' */
  mouseEncoding: string
  cursorHidden: boolean
}

const DEFAULT_MODES: TerminalModeSnapshot = { mouseEncoding: 'DEFAULT', cursorHidden: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read the non-serialized modes from an xterm Terminal (internal API, guarded). */
export function readTerminalModes(terminal: unknown): TerminalModeSnapshot {
  if (!isRecord(terminal) || !isRecord(terminal._core)) return { ...DEFAULT_MODES }
  const core = terminal._core
  const mouse = core.coreMouseService
  const coreService = core.coreService
  return {
    mouseEncoding:
      isRecord(mouse) && typeof mouse.activeEncoding === 'string'
        ? mouse.activeEncoding
        : DEFAULT_MODES.mouseEncoding,
    cursorHidden:
      isRecord(coreService) && typeof coreService.isCursorHidden === 'boolean'
        ? coreService.isCursorHidden
        : DEFAULT_MODES.cursorHidden,
  }
}

/** Escape sequences that re-apply `modes` on top of a SerializeAddon replay. */
export function buildModeRestoreSequence(modes: TerminalModeSnapshot): string {
  let seq = ''
  if (modes.mouseEncoding === 'SGR') seq += '\x1b[?1006h'
  else if (modes.mouseEncoding === 'SGR_PIXELS') seq += '\x1b[?1016h'
  if (modes.cursorHidden) seq += '\x1b[?25l'
  return seq
}
