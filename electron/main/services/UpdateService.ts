import pkg from 'electron-updater'
const { autoUpdater } = pkg
import type { UpdateInfo, ProgressInfo } from 'electron-updater'
import { BrowserWindow, app } from 'electron'

export class UpdateService {
  private mainWindow: BrowserWindow | null = null
  isUpdateInProgress = false

  initialize(window: BrowserWindow) {
    this.mainWindow = window

    // Configuration
    autoUpdater.autoDownload = false // Let user choose when to download
    autoUpdater.autoInstallOnAppQuit = false // Prevent conflict with explicit quitAndInstall
    autoUpdater.autoRunAppAfterInstall = true

    // Setup event handlers
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      this.sendToRenderer('update:checking')
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.sendToRenderer('update:available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.sendToRenderer('update:not-available')
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.sendToRenderer('update:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.sendToRenderer('update:downloaded', {
        version: info.version,
      })
    })

    autoUpdater.on('error', (error: Error) => {
      this.sendToRenderer('update:error', {
        message: error.message,
      })
    })
  }

  private sendToRenderer(channel: string, data?: unknown) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  async checkForUpdates() {
    // Only check in packaged builds
    if (!app.isPackaged) {
      return { updateAvailable: false, isDev: true }
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        updateAvailable: result?.updateInfo?.version !== app.getVersion(),
        version: result?.updateInfo?.version,
        currentVersion: app.getVersion(),
      }
    } catch (error) {
      console.error('Error checking for updates:', error)
      throw error
    }
  }

  async downloadUpdate() {
    if (!app.isPackaged) {
      return { success: false, isDev: true }
    }

    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      console.error('Error downloading update:', error)
      throw error
    }
  }

  quitAndInstall() {
    if (!app.isPackaged) {
      return
    }

    // Silent install + force run after. Non-silent mode shows NSIS UI that
    // detects the still-running process and fails. isForceRunAfter is also
    // ignored when isSilent=false.
    autoUpdater.quitAndInstall(true, true)
  }

  getCurrentVersion(): string {
    return app.getVersion()
  }
}
