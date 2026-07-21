import { BrowserWindow, screen } from 'electron'
import { shouldShowStrip, computeStripBounds } from './notchVisibility'
import { computeSurfacedIds } from './notchPopPolicy'
import type { NotchPayload, NotchSession } from '../../../shared/ipc-types'

const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 140
const MIN_WIDTH = 280
const MAX_WIDTH = 560
const MIN_HEIGHT = 44

/**
 * Paths the strip window needs to load the renderer. Mirrors the resolution
 * used by the main window in index.ts (preload + dev-server-url vs packaged
 * index.html).
 */
export interface NotchServiceConfig {
  preload: string
  indexHtml: string
  devServerUrl?: string
}

/**
 * Owns the "notch" strip: a second frameless, always-on-top, taskbar-less
 * BrowserWindow that renders the cross-project agent-status surface. It reuses
 * the same preload and renderer bundle as the main window, selecting the strip
 * view via a `#strip` hash route (see src/main.tsx).
 *
 * Visibility is foreground-driven (U2): the strip appears only while the main
 * window is backgrounded, the notch is enabled, and there is content to show.
 * The session feed (U3), pop policy (U4), and click routing (U6) build on this.
 * The window is sized to the strip's reported content so the expanded list is
 * never clipped.
 */
export class NotchService {
  private strip: BrowserWindow | null = null
  private destroyed = false

  // Visibility inputs — see notchVisibility.shouldShowStrip. The app starts
  // with the main window focused; enabled defaults on; content arrives in U3.
  private mainForeground = true
  private enabled = true
  private hasContent = false
  // Top-center placement happens once; after that the window keeps its position
  // (including wherever the user dragged it) across hide/show.
  private placed = false
  private sessions: NotchSession[] = []
  private surfacedIds: string[] = []
  // Finished (done) sessions the user has already seen — Command was focused
  // while they were done. A seen finish stays cleared until it finishes anew.
  private acknowledgedDone = new Set<string>()

  // Window size, driven by the strip's reported content size (setContentSize).
  private contentWidth = DEFAULT_WIDTH
  private contentHeight = DEFAULT_HEIGHT

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly config: NotchServiceConfig,
  ) {}

  /**
   * Lazily create the strip window (hidden). Lazy creation keeps startup light
   * and avoids a second renderer load when the notch is never shown.
   */
  private ensureStrip(): BrowserWindow {
    if (this.strip && !this.strip.isDestroyed()) return this.strip

    const strip = new BrowserWindow({
      width: this.contentWidth,
      height: this.contentHeight,
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: true,
      closable: false, // dismiss is the ✕ (setEnabled false); prevent Alt+F4 orphaning the window
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.config.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    // Keep the strip above normal windows without stealing focus.
    strip.setAlwaysOnTop(true, 'screen-saver')
    // The strip renders no links; deny any window-open for parity with the
    // main window's hardening.
    strip.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    if (this.config.devServerUrl) {
      void strip.loadURL(`${this.config.devServerUrl}#strip`)
    } else {
      void strip.loadFile(this.config.indexHtml, { hash: 'strip' })
    }

    strip.on('closed', () => {
      this.strip = null
      // A recreated strip must re-place itself top-center rather than reappear
      // at the OS default position.
      this.placed = false
    })

    // A freshly-created strip may be shown before its renderer is ready; push
    // the current snapshot once it can receive it.
    strip.webContents.once('did-finish-load', () => this.pushToStrip())

    this.strip = strip
    return strip
  }

  /** Called from the main window's focus/blur (and hide/show) handlers. */
  setMainForeground(foreground: boolean): void {
    this.mainForeground = foreground
    if (foreground) {
      // Focusing Command "sees" any finished session, so it won't reappear on
      // the next background until it finishes again.
      let acknowledged = false
      for (const s of this.sessions) {
        if (s.state === 'done' && !this.acknowledgedDone.has(s.id)) {
          this.acknowledgedDone.add(s.id)
          acknowledged = true
        }
      }
      if (acknowledged) {
        this.recomputeSurfaced()
        return
      }
    }
    this.updateVisibility()
  }

  /** Notch enable/disable — wired to the sidebar toggle and hide button (U8). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.updateVisibility()
  }

  /** Whether any sessions are currently surfaced — driven by the feed (U3/U4). */
  setHasContent(hasContent: boolean): void {
    this.hasContent = hasContent
    this.updateVisibility()
  }

  /**
   * The strip reports its rendered content size so the window fits it exactly
   * (the expanded list would otherwise clip against a fixed height). Clamped to
   * sane bounds; the work-area clamp happens in computeStripBounds.
   */
  setContentSize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return
    this.contentWidth = Math.min(Math.max(Math.round(width), MIN_WIDTH), MAX_WIDTH)
    this.contentHeight = Math.max(Math.round(height), MIN_HEIGHT)
    const strip = this.strip
    if (!strip || strip.isDestroyed()) return
    // Resize in place — keep the current (possibly user-dragged) position,
    // clamped so the window stays fully within the display it sits on.
    const b = strip.getBounds()
    const { workArea } = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const w = Math.min(this.contentWidth, workArea.width)
    const h = Math.min(this.contentHeight, workArea.height)
    const x = Math.max(workArea.x, Math.min(b.x, workArea.x + workArea.width - w))
    const y = Math.max(workArea.y, Math.min(b.y, workArea.y + workArea.height - h))
    // Skip no-op setBounds so a 1px DPI oscillation can't churn the window.
    if (b.x === x && b.y === y && b.width === w && b.height === h) return
    strip.setBounds({ x, y, width: w, height: h })
  }

  /**
   * Return to a session: raise and focus the main window, then tell its
   * renderer to activate the terminal. Focusing the main window fires its
   * `focus` handler, which hides the strip.
   */
  focusSession(terminalId: string): void {
    if (this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
    this.mainWindow.webContents.send('notch:activate-terminal', terminalId)
  }

  /**
   * Receive the latest cross-project session snapshot from the main renderer
   * and re-run the pop policy. Every live session surfaces (the live overview);
   * a finished session stays until Command is next focused, then clears.
   */
  setSessions(payload: NotchPayload): void {
    this.sessions = payload.sessions
    // A session that is no longer 'done' can flash again next time it finishes.
    const doneIds = new Set(this.sessions.filter((s) => s.state === 'done').map((s) => s.id))
    for (const id of this.acknowledgedDone) {
      if (!doneIds.has(id)) this.acknowledgedDone.delete(id)
    }
    this.recomputeSurfaced()
  }

  private recomputeSurfaced(): void {
    this.surfacedIds = [...computeSurfacedIds(this.sessions, this.acknowledgedDone)]
    this.pushToStrip()
    this.setHasContent(this.surfacedIds.length > 0)
  }

  private pushToStrip(): void {
    if (this.strip && !this.strip.isDestroyed()) {
      this.strip.webContents.send('notch:state', {
        sessions: this.sessions,
        surfacedIds: this.surfacedIds,
      })
    }
  }

  private updateVisibility(): void {
    if (this.destroyed) return
    const show = shouldShowStrip({
      mainForeground: this.mainForeground,
      enabled: this.enabled,
      hasContent: this.hasContent,
    })
    if (show) {
      const strip = this.ensureStrip()
      if (!strip.isVisible()) {
        // Place top-center on first show, or whenever the window has drifted
        // fully off every display (e.g. a monitor was unplugged); otherwise
        // keep the user's position.
        if (!this.placed || !this.isOnScreen(strip)) {
          this.reposition(strip)
          this.placed = true
        }
        strip.showInactive()
      }
    } else if (this.strip && !this.strip.isDestroyed() && this.strip.isVisible()) {
      this.strip.hide()
    }
  }

  /** Place the strip top-center on the display under the cursor, sized to content. */
  private reposition(strip: BrowserWindow): void {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    strip.setBounds(
      computeStripBounds(display.workArea, { width: this.contentWidth, height: this.contentHeight }),
    )
  }

  /** True when the strip overlaps at least one display's work area. */
  private isOnScreen(strip: BrowserWindow): boolean {
    const b = strip.getBounds()
    return screen.getAllDisplays().some((d) => {
      const w = d.workArea
      return b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y
    })
  }

  destroy(): void {
    this.destroyed = true
    if (this.strip && !this.strip.isDestroyed()) {
      this.strip.destroy()
    }
    this.strip = null
  }
}
