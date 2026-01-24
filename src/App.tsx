import { useEffect, useState, useMemo, useRef } from 'react'
import { MainLayout } from './components/Layout/MainLayout'
import { useProjectStore } from './stores/projectStore'
import { getElectronAPI } from './utils/electron'

function App() {
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const terminals = useProjectStore((s) => s.terminals)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)
  const hasActiveTerminals = Object.keys(terminals).length > 0
  const api = useMemo(() => getElectronAPI(), [])

  // Use ref to access current value in callback without re-registering listener
  const hasActiveTerminalsRef = useRef(hasActiveTerminals)
  hasActiveTerminalsRef.current = hasActiveTerminals

  // Listen for close request from main process - register once, cleanup on unmount
  useEffect(() => {
    const unsubscribe = api.app.onCloseRequest(() => {
      if (hasActiveTerminalsRef.current) {
        setShowCloseDialog(true)
      } else {
        api.app.confirmClose()
      }
    })
    return unsubscribe
  }, [api])

  // Remove loading screen
  useEffect(() => {
    postMessage({ payload: 'removeLoading' }, '*')
  }, [])

  const handleConfirmClose = () => {
    setShowCloseDialog(false)
    api.app.confirmClose()
  }

  const handleCancelClose = () => {
    setShowCloseDialog(false)
    api.app.cancelClose()
  }

  return (
    <>
      <MainLayout />

      {/* Close Confirmation Dialog */}
      {showCloseDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-claude-main-surface border border-claude-main-border rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <h2 className="text-lg font-semibold text-claude-main-text mb-2">
              Close Application?
            </h2>
            <p className="text-sm text-claude-main-muted mb-6">
              You have {Object.keys(terminals).length} active terminal
              {Object.keys(terminals).length > 1 ? 's' : ''}. Closing the
              application will terminate all running sessions.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancelClose}
                className="px-4 py-2 text-sm text-claude-main-muted hover:text-claude-main-text rounded-lg hover:bg-claude-main-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClose}
                className="px-4 py-2 text-sm bg-claude-error text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                Close Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
