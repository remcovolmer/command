import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { MainLayout } from './components/Layout/MainLayout'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from './stores/projectStore'
import { SettingsDialog } from './components/Settings/SettingsDialog'
import { ShortcutsOverlay } from './components/Settings/ShortcutsOverlay'
import type { TerminalSession } from './types'
import { getElectronAPI } from './utils/electron'
import { useHotkeys, useDialogHotkeys } from './hooks/useHotkeys'

function App() {
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const terminals = useProjectStore((s) => s.terminals)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)
  const setFileExplorerVisible = useProjectStore((s) => s.setFileExplorerVisible)
  const setFileExplorerActiveTab = useProjectStore((s) => s.setFileExplorerActiveTab)
  const theme = useProjectStore((s) => s.theme)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)
  const settingsDialogOpen = useProjectStore((s) => s.settingsDialogOpen)
  const setSettingsDialogOpen = useProjectStore((s) => s.setSettingsDialogOpen)
  const addToSplit = useProjectStore((s) => s.addToSplit)
  const removeFromSplit = useProjectStore((s) => s.removeFromSplit)
  const getLayout = useProjectStore((s) => s.getLayout)
  const closeEditorTab = useProjectStore((s) => s.closeEditorTab)
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

  // Helper to get visual order of projects (active first, then inactive)
  const getProjectVisualOrder = useCallback(() => {
    const { projects, terminals } = useProjectStore.getState()
    if (projects.length === 0) return []

    const terminalValues = Object.values(terminals)
    const activeProjects = projects.filter(p => terminalValues.some(t => t.projectId === p.id))
    const inactiveProjects = projects.filter(p => !terminalValues.some(t => t.projectId === p.id))
    return [...activeProjects, ...inactiveProjects]
  }, [])

  // Helper to switch to terminal by index (1-9)
  const switchToTerminal = useCallback((index: number) => {
    const { activeProjectId, getProjectTerminals, setActiveTerminal } = useProjectStore.getState()
    if (!activeProjectId) return

    const projectTerminals = getProjectTerminals(activeProjectId)
    if (index < projectTerminals.length) {
      setActiveTerminal(projectTerminals[index].id)
    }
  }, [])

  // Register all hotkeys
  useHotkeys({
    // Navigation
    'nav.previousProject': () => {
      const { activeProjectId, setActiveProject } = useProjectStore.getState()
      const visualOrder = getProjectVisualOrder()
      if (visualOrder.length === 0) return

      const currentIndex = visualOrder.findIndex(p => p.id === activeProjectId)
      const newIndex = (currentIndex - 1 + visualOrder.length) % visualOrder.length
      setActiveProject(visualOrder[newIndex].id)
    },

    'nav.nextProject': () => {
      const { activeProjectId, setActiveProject } = useProjectStore.getState()
      const visualOrder = getProjectVisualOrder()
      if (visualOrder.length === 0) return

      const currentIndex = visualOrder.findIndex(p => p.id === activeProjectId)
      const newIndex = (currentIndex + 1) % visualOrder.length
      setActiveProject(visualOrder[newIndex].id)
    },

    'nav.previousTerminal': () => {
      const { activeProjectId, activeTerminalId, getProjectTerminals, setActiveTerminal } = useProjectStore.getState()
      if (!activeProjectId) return

      const projectTerminals = getProjectTerminals(activeProjectId)
      if (projectTerminals.length === 0) return

      const currentIndex = projectTerminals.findIndex(t => t.id === activeTerminalId)
      const newIndex = (currentIndex - 1 + projectTerminals.length) % projectTerminals.length
      setActiveTerminal(projectTerminals[newIndex].id)
    },

    'nav.nextTerminal': () => {
      const { activeProjectId, activeTerminalId, getProjectTerminals, setActiveTerminal } = useProjectStore.getState()
      if (!activeProjectId) return

      const projectTerminals = getProjectTerminals(activeProjectId)
      if (projectTerminals.length === 0) return

      const currentIndex = projectTerminals.findIndex(t => t.id === activeTerminalId)
      const newIndex = (currentIndex + 1) % projectTerminals.length
      setActiveTerminal(projectTerminals[newIndex].id)
    },

    'nav.focusSidebar': () => {
      // Focus the sidebar by finding the first focusable element
      const sidebar = document.querySelector('[data-sidebar]')
      if (sidebar) {
        const focusable = sidebar.querySelector('button, [tabindex="0"]') as HTMLElement
        focusable?.focus()
      }
    },

    'nav.focusTerminal': () => {
      // Focus the active terminal
      const terminal = document.querySelector('[data-terminal-active="true"]')
      if (terminal) {
        const terminalEl = terminal.querySelector('.xterm-helper-textarea') as HTMLElement
        terminalEl?.focus()
      }
    },

    'nav.focusFileExplorer': () => {
      // Open file explorer if closed, then focus
      const { fileExplorerVisible, setFileExplorerVisible } = useProjectStore.getState()
      if (!fileExplorerVisible) {
        setFileExplorerVisible(true)
      }
      // Focus the file explorer
      setTimeout(() => {
        const fileExplorer = document.querySelector('[data-file-explorer]')
        if (fileExplorer) {
          const focusable = fileExplorer.querySelector('button, [tabindex="0"]') as HTMLElement
          focusable?.focus()
        }
      }, 50)
    },

    // Terminal operations
    'terminal.new': () => {
      const { activeProjectId, getProjectTerminals, addTerminal } = useProjectStore.getState()
      if (!activeProjectId) return

      const projectTerminals = getProjectTerminals(activeProjectId)
      if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
        api.notification.show(
          'Chat Limit',
          `Maximum ${MAX_TERMINALS_PER_PROJECT} chats per project`
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
          title: `Chat ${projectTerminals.length + 1}`,
          type: 'claude',
        }
        addTerminal(terminal)
      })()
    },

    'terminal.close': () => {
      const { activeProjectId, activeTerminalId, removeTerminal } = useProjectStore.getState()
      if (!activeProjectId || !activeTerminalId) return

      api.terminal.close(activeTerminalId)
      removeTerminal(activeTerminalId)
    },

    'terminal.split': () => {
      const { activeProjectId, activeTerminalId } = useProjectStore.getState()
      if (!activeProjectId || !activeTerminalId) return
      addToSplit(activeProjectId, activeTerminalId)
    },

    'terminal.unsplit': () => {
      const { activeProjectId, activeTerminalId } = useProjectStore.getState()
      if (!activeProjectId || !activeTerminalId) return
      removeFromSplit(activeProjectId, activeTerminalId)
    },

    // Terminal shortcuts Alt+1-9 (generated handlers)
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `terminal.goTo${i + 1}`,
        () => switchToTerminal(i)
      ])
    ),

    // File explorer
    'fileExplorer.toggle': toggleFileExplorer,
    'fileExplorer.filesTab': () => {
      setFileExplorerVisible(true)
      setFileExplorerActiveTab('files')
    },
    'fileExplorer.gitTab': () => {
      setFileExplorerVisible(true)
      setFileExplorerActiveTab('git')
    },

    // Editor
    'editor.closeTab': () => {
      const { activeCenterTabId, editorTabs } = useProjectStore.getState()
      if (activeCenterTabId && editorTabs[activeCenterTabId]) {
        closeEditorTab(activeCenterTabId)
      }
    },
    'editor.nextTab': () => {
      const { editorTabs, activeCenterTabId, setActiveCenterTab } = useProjectStore.getState()
      const tabs = Object.values(editorTabs)
      if (tabs.length === 0) return

      const currentIndex = tabs.findIndex(t => t.id === activeCenterTabId)
      const nextIndex = (currentIndex + 1) % tabs.length
      setActiveCenterTab(tabs[nextIndex].id)
    },
    'editor.previousTab': () => {
      const { editorTabs, activeCenterTabId, setActiveCenterTab } = useProjectStore.getState()
      const tabs = Object.values(editorTabs)
      if (tabs.length === 0) return

      const currentIndex = tabs.findIndex(t => t.id === activeCenterTabId)
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
      setActiveCenterTab(tabs[prevIndex].id)
    },
    'editor.save': () => {
      // Editor save is handled by CodeEditor component via Monaco
      // This is a fallback that triggers the active editor's save
      const event = new CustomEvent('editor-save-request')
      window.dispatchEvent(event)
    },

    // UI & Settings
    'ui.openSettings': () => setSettingsDialogOpen(true),
    'ui.toggleTheme': toggleTheme,
    'ui.showShortcuts': () => setShowShortcuts(true),
  })

  // Close dialog with Escape
  useDialogHotkeys(
    () => setShowCloseDialog(false),
    () => {}, // Don't confirm close on Enter
    { enabled: showCloseDialog, canConfirm: false }
  )

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

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />

      {/* Shortcuts Overlay */}
      <ShortcutsOverlay
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

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
