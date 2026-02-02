import { useEffect, useState, useMemo, useRef } from 'react'
import { MainLayout } from './components/Layout/MainLayout'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from './stores/projectStore'
import type { TerminalSession } from './types'
import { getElectronAPI } from './utils/electron'

function App() {
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const terminals = useProjectStore((s) => s.terminals)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)
  const theme = useProjectStore((s) => s.theme)
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Alt+B to toggle file explorer
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleFileExplorer()
        return
      }

      // Ctrl + Up/Down: Switch projects
      if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const { projects, activeProjectId, setActiveProject, terminals } = useProjectStore.getState()
        if (projects.length === 0) return

        // Match sidebar visual order: active projects first, then inactive
        const terminalValues = Object.values(terminals)
        const activeProjects = projects.filter(p => terminalValues.some(t => t.projectId === p.id))
        const inactiveProjects = projects.filter(p => !terminalValues.some(t => t.projectId === p.id))
        const visualOrder = [...activeProjects, ...inactiveProjects]

        const currentIndex = visualOrder.findIndex(p => p.id === activeProjectId)
        const direction = e.key === 'ArrowDown' ? 1 : -1
        const newIndex = (currentIndex + direction + visualOrder.length) % visualOrder.length
        setActiveProject(visualOrder[newIndex].id)
        return
      }

      // Ctrl + Left/Right: Switch terminals within project (with wrap-around)
      if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const { activeProjectId, activeTerminalId, getProjectTerminals, setActiveTerminal } = useProjectStore.getState()
        if (!activeProjectId) return

        const terminals = getProjectTerminals(activeProjectId)
        if (terminals.length === 0) return

        const currentIndex = terminals.findIndex(t => t.id === activeTerminalId)
        const direction = e.key === 'ArrowRight' ? 1 : -1
        const newIndex = (currentIndex + direction + terminals.length) % terminals.length
        setActiveTerminal(terminals[newIndex].id)
        return
      }

      // Ctrl + T: Create new terminal in active project
      if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        const { activeProjectId, terminals, getProjectTerminals, addTerminal } = useProjectStore.getState()
        if (!activeProjectId) return

        const projectTerminals = getProjectTerminals(activeProjectId)
        if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
          api.notification.show(
            'Terminal Limit',
            `Maximum ${MAX_TERMINALS_PER_PROJECT} terminals per project`
          )
          return
        }

        ;(async () => {
          const terminalId = await api.terminal.create(activeProjectId)
          const terminal: TerminalSession = {
            id: terminalId,
            projectId: activeProjectId,
            worktreeId: null,
            state: 'busy',
            lastActivity: Date.now(),
            title: `Terminal ${projectTerminals.length + 1}`,
            type: 'claude',
          }
          addTerminal(terminal)
        })()
        return
      }

      // Ctrl + W: Close active terminal
      if (e.ctrlKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        const { activeProjectId, activeTerminalId, removeTerminal } = useProjectStore.getState()
        if (!activeProjectId || !activeTerminalId) return

        api.terminal.close(activeTerminalId)
        removeTerminal(activeTerminalId)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [toggleFileExplorer, api])

  // Sync theme class with html element (only add 'dark' class when dark mode)
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

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
          <div className="bg-card border border-border rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <h2 className="text-lg font-semibold text-card-foreground mb-2">
              Close Application?
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              You have {Object.keys(terminals).length} active terminal
              {Object.keys(terminals).length > 1 ? 's' : ''}. Closing the
              application will terminate all running sessions.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancelClose}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClose}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity"
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
