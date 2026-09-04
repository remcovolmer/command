import { useState, useEffect } from 'react'
import { AlertCircle, Download, Check } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import type { UpdateAvailableInfo, UpdateProgressInfo } from '../../types'
import { Toast } from '../ui/Toast'
import { btnPrimary, btnSecondary } from '../ui/controls'

type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

const smallPrimary = `${btnPrimary} h-7 px-2.5 text-[12.5px]`
const smallSecondary = `${btnSecondary} h-7 px-2.5 text-[12.5px]`

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

  if (state === 'error') {
    return (
      <Toast tone="danger" icon={AlertCircle} title="Update failed" onDismiss={handleDismiss} fixed>
        <p className="text-[12.5px] text-fg-muted mt-0.5 break-words">{error}</p>
      </Toast>
    )
  }

  if (state === 'available' && updateInfo) {
    return (
      <Toast tone="info" icon={Download} title="Update available" onDismiss={handleDismiss} fixed>
        <p className="text-[12.5px] text-fg-muted mt-0.5">
          Version <span className="font-mono tnum">{updateInfo.version}</span> is ready to download
        </p>
        <div className="flex gap-2 mt-3">
          <button onClick={handleDownload} className={smallPrimary}>
            Download
          </button>
          <button onClick={handleDismiss} className={smallSecondary}>
            Later
          </button>
        </div>
      </Toast>
    )
  }

  if (state === 'downloading' && progress) {
    const percent = Math.round(progress.percent)
    const speed = (progress.bytesPerSecond / 1024 / 1024).toFixed(1)

    return (
      <Toast tone="info" icon={Download} title="Downloading update…" fixed>
        <div className="mt-2 w-full bg-raised rounded-full h-1">
          <div
            className="bg-primary h-1 rounded-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="font-mono text-[11px] text-fg-muted tnum mt-1.5">
          {percent}% · {speed} MB/s
        </p>
      </Toast>
    )
  }

  if (state === 'downloaded') {
    return (
      <Toast tone="success" icon={Check} title="Update ready" onDismiss={handleDismiss} fixed>
        <p className="text-[12.5px] text-fg-muted mt-0.5">Restart to install the update</p>
        <div className="flex gap-2 mt-3">
          <button onClick={handleInstall} className={smallPrimary}>
            Restart now
          </button>
          <button onClick={handleDismiss} className={smallSecondary}>
            Later
          </button>
        </div>
      </Toast>
    )
  }

  return null
}
