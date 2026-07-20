import { BrowserWindow, screen } from 'electron'
import { shouldShowStrip, computeStripBounds } from './notchVisibility'

const STRIP_WIDTH = 380
const STRIP_HEIGHT = 140

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
 */
export class NotchService {
  private strip: BrowserWindow | null = null
  private destroyed = false

  // Visibility inputs — see notchVisibility.shouldShowStrip. The app starts
  // with the main window focused; enabled defaults on; content arrives in U3.
  private mainForeground = true
  private enabled = true
  private hasContent = false

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
      width: STRIP_WIDTH,
      height: STRIP_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
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

    if (this.config.devServerUrl) {
      void strip.loadURL(`${this.config.devServerUrl}#strip`)
    } else {
      void strip.loadFile(this.config.indexHtml, { hash: 'strip' })
    }

    strip.on('closed', () => {
      this.strip = null
    })

    this.strip = strip
    return strip
  }

  /** Called from the main window's focus/blur handlers. */
  setMainForeground(foreground: boolean): void {
    this.mainForeground = foreground
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

  /** True when the main window is the focused window. */
  isMainForeground(): boolean {
    return !this.mainWindow.isDestroyed() && this.mainWindow.isFocused()
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
      this.reposition(strip)
      if (!strip.isVisible()) strip.showInactive()
    } else if (this.strip && !this.strip.isDestroyed() && this.strip.isVisible()) {
      this.strip.hide()
    }
  }

  /** Place the strip top-center on the display under the cursor. */
  private reposition(strip: BrowserWindow): void {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    strip.setBounds(
      computeStripBounds(display.workArea, { width: STRIP_WIDTH, height: STRIP_HEIGHT }),
    )
  }

  destroy(): void {
    this.destroyed = true
    if (this.strip && !this.strip.isDestroyed()) {
      this.strip.destroy()
    }
    this.strip = null
  }
}
