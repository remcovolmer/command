import { useState, useEffect } from 'react'
import { getElectronAPI } from '../../utils/electron'
import type { UpdateAvailableInfo, UpdateProgressInfo } from '../../types'

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateAvailableInfo | null>(null)
  const [progress, setProgress] = useState<UpdateProgressInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const api = getElectronAPI()
    if (!api?.update) return

    const unsubChecking = api.update.onChecking(() => {
      setState('checking')
    })

    const unsubAvailable = api.update.onAvailable((info) => {
      setState('available')
      setUpdateInfo(info)
      setDismissed(false)
    })

    const unsubNotAvailable = api.update.onNotAvailable(() => {
      setState('idle')
    })

    const unsubProgress = api.update.onProgress((prog) => {
      setState('downloading')
      setProgress(prog)
    })

    const unsubDownloaded = api.update.onDownloaded(() => {
      setState('downloaded')
      setProgress(null)
    })

    const unsubError = api.update.onError((err) => {
      setState('error')
      setError(err.message)
    })

    return () => {
      unsubChecking()
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  const handleDownload = async () => {
    const api = getElectronAPI()
    if (!api?.update) return

    try {
      await api.update.download()
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  const handleInstall = () => {
    const api = getElectronAPI()
    if (!api?.update) return
    api.update.install()
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  // Don't show anything if idle, checking, or dismissed
  if (state === 'idle' || state === 'checking' || dismissed) {
    return null
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="fixed bottom-4 right-4 bg-red-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
        <div className="flex items-start gap-3">
          <div className="text-red-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium">Update failed</p>
            <p className="text-sm text-red-200 mt-1">{error}</p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-red-300 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // Update available state
  if (state === 'available' && updateInfo) {
    return (
      <div className="fixed bottom-4 right-4 bg-blue-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
        <div className="flex items-start gap-3">
          <div className="text-blue-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium">Update available</p>
            <p className="text-sm text-blue-200 mt-1">Version {updateInfo.version} is ready to download</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
              >
                Download
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 bg-blue-800 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Downloading state
  if (state === 'downloading' && progress) {
    const percent = Math.round(progress.percent)
    const speed = (progress.bytesPerSecond / 1024 / 1024).toFixed(1)

    return (
      <div className="fixed bottom-4 right-4 bg-blue-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
        <div className="flex items-start gap-3">
          <div className="text-blue-400 animate-pulse">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium">Downloading update...</p>
            <div className="mt-2 w-full bg-blue-800 rounded-full h-2">
              <div
                className="bg-blue-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-blue-300 mt-1">{percent}% - {speed} MB/s</p>
          </div>
        </div>
      </div>
    )
  }

  // Downloaded state
  if (state === 'downloaded') {
    return (
      <div className="fixed bottom-4 right-4 bg-green-900/90 text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
        <div className="flex items-start gap-3">
          <div className="text-green-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium">Update ready</p>
            <p className="text-sm text-green-200 mt-1">Restart to install the update</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-medium transition-colors"
              >
                Restart now
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 bg-green-800 hover:bg-green-700 rounded text-sm font-medium transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}
