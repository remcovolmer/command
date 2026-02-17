import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { MainLayout } from './components/Layout/MainLayout'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from './stores/projectStore'
import { SettingsDialog } from './components/Settings/SettingsDialog'
import { ShortcutsOverlay } from './components/Settings/ShortcutsOverlay'
import type { TerminalSession } from './types'
import { getElectronAPI } from './utils/electron'
import { useHotkeys, useDialogHotkeys } from './hooks/useHotkeys'
import { fileWatcherEvents } from './utils/fileWatcherEvents'

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

  // Refocus the active terminal's xterm textarea (e.g. after closing dialogs)
  const refocusActiveTerminal = useCallback(() => {
    requestAnimationFrame(() => {
      const terminal = document.querySelector('[data-terminal-active="true"]')
      if (terminal) {
        const textarea = terminal.querySelector('.xterm-helper-textarea') as HTMLElement
        textarea?.focus()
      }
    })
  }, [])

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

  // Helper to get visual order of projects (workspaces → active regular → inactive regular)
  const getProjectVisualOrder = useCallback(() => {
    const { projects, terminals } = useProjectStore.getState()
    if (projects.length === 0) return []

    const terminalValues = Object.values(terminals)
    const workspaces = projects.filter(p => p.type === 'workspace')
    const regular = projects.filter(p => p.type !== 'workspace')
    const activeRegular = regular.filter(p => terminalValues.some(t => t.projectId === p.id))
    const inactiveRegular = regular.filter(p => !terminalValues.some(t => t.projectId === p.id))
    return [...workspaces, ...activeRegular, ...inactiveRegular]
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
    'fileExplorer.tasksTab': () => {
      setFileExplorerVisible(true)
      setFileExplorerActiveTab('tasks')
    },
    'fileExplorer.newFile': () => {
      const { activeProjectId, projects, fileExplorerSelectedPath, fileExplorerVisible } = useProjectStore.getState()
      if (!activeProjectId || !fileExplorerVisible) return
      const project = projects.find(p => p.id === activeProjectId)
      if (!project) return
      // Determine parent: selected directory or project root
      const parentPath = fileExplorerSelectedPath ?? project.path
      useProjectStore.getState().startCreate(parentPath, 'file')
    },
    'fileExplorer.newFolder': () => {
      const { activeProjectId, projects, fileExplorerSelectedPath, fileExplorerVisible } = useProjectStore.getState()
      if (!activeProjectId || !fileExplorerVisible) return
      const project = projects.find(p => p.id === activeProjectId)
      if (!project) return
      const parentPath = fileExplorerSelectedPath ?? project.path
      useProjectStore.getState().startCreate(parentPath, 'directory')
    },
    'fileExplorer.rename': () => {
      // Only fire when file explorer has focus
      if (!document.querySelector('[data-file-explorer]:focus-within')) return
      const { fileExplorerSelectedPath } = useProjectStore.getState()
      if (fileExplorerSelectedPath) {
        useProjectStore.getState().startRename(fileExplorerSelectedPath)
      }
    },
    'fileExplorer.delete': () => {
      // Only fire when file explorer has focus
      if (!document.querySelector('[data-file-explorer]:focus-within')) return
      const { fileExplorerSelectedPath, directoryCache } = useProjectStore.getState()
      if (!fileExplorerSelectedPath) return
      // Find the entry in the cache
      for (const entries of Object.values(directoryCache)) {
        const found = entries.find(e => e.path === fileExplorerSelectedPath)
        if (found) {
          useProjectStore.getState().setDeletingEntry(found)
          break
        }
      }
    },
    'fileExplorer.copyPath': () => {
      // Only fire when file explorer has focus
      if (!document.querySelector('[data-file-explorer]:focus-within')) return
      const { fileExplorerSelectedPath } = useProjectStore.getState()
      if (fileExplorerSelectedPath) {
        navigator.clipboard.writeText(fileExplorerSelectedPath)
      }
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

  // Restore terminal focus when window regains focus
  useEffect(() => {
    const handleWindowFocus = () => refocusActiveTerminal()
    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
  }, [refocusActiveTerminal])

  // Initialize file watcher events (centralized IPC listener)
  useEffect(() => {
    fileWatcherEvents.init()
    return () => fileWatcherEvents.dispose()
  }, [])

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
    refocusActiveTerminal()
  }

  return (
    <>
      <MainLayout />

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => { setSettingsDialogOpen(false); refocusActiveTerminal() }}
      />

      {/* Shortcuts Overlay */}
      <ShortcutsOverlay
        isOpen={showShortcuts}
        onClose={() => { setShowShortcuts(false); refocusActiveTerminal() }}
      />

      {/* Close Confirmation Dialog */}
      {showCloseDialog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div className="bg-sidebar border border-border rounded-xl max-w-md mx-4 shadow-2xl">
            <div className="px-5 py-3 border-b border-border/30 bg-sidebar-accent/30 rounded-t-xl">
              <h2 className="text-sm font-semibold text-foreground">
                Close Application?
              </h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground">
                You have {Object.keys(terminals).length} active terminal
                {Object.keys(terminals).length > 1 ? 's' : ''}. Closing the
                application will terminate all running sessions.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-5 py-3 border-t border-border/30">
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
