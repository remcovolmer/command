import { BrowserWindow } from 'electron'

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
 * U1 scope: window lifecycle only (create hidden, show/hide, destroy).
 * Foreground-driven visibility (U2), the session feed (U3), pop policy (U4),
 * and click routing (U6) build on this shell.
 */
export class NotchService {
  private strip: BrowserWindow | null = null
  private destroyed = false

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
      width: 380,
      height: 140,
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

  /**
   * Show the strip without stealing focus from the foreground window. U2
   * replaces the caller with foreground-driven logic; kept public so the
   * lifecycle is exercisable in isolation.
   */
  show(): void {
    if (this.destroyed) return
    const strip = this.ensureStrip()
    if (!strip.isVisible()) strip.showInactive()
  }

  hide(): void {
    if (this.strip && !this.strip.isDestroyed() && this.strip.isVisible()) {
      this.strip.hide()
    }
  }

  /** True when the main window is the focused window. Used by U2. */
  isMainForeground(): boolean {
    return !this.mainWindow.isDestroyed() && this.mainWindow.isFocused()
  }

  destroy(): void {
    this.destroyed = true
    if (this.strip && !this.strip.isDestroyed()) {
      this.strip.destroy()
    }
    this.strip = null
  }
}
