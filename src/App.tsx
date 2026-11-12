import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { MainLayout } from './components/Layout/MainLayout'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from './stores/projectStore'
import { SettingsDialog } from './components/Settings/SettingsDialog'
import { ShortcutsOverlay } from './components/Settings/ShortcutsOverlay'
import type { TerminalSession } from './types'
import { getElectronAPI } from './utils/electron'
import { useHotkeys, useDialogHotkeys } from './hooks/useHotkeys'
import { useNotchFeed } from './hooks/useNotchFeed'
import { fileWatcherEvents } from './utils/fileWatcherEvents'
import { useThemeResolver } from './hooks/useThemeResolver'
import { dismissTopmostToast } from './utils/toastRegistry'
import { DEFAULT_HOTKEY_CONFIG, matchesBinding } from './utils/hotkeys'
import {
  emitBrowserShortcut,
  isBrowserShortcutAction,
  type BrowserShortcutAction,
} from './utils/browserShortcutBus'
import {
  ACTIVE_CHAT_TEXTAREA_SELECTOR,
  focusActiveChatTerminal,
  shouldConsumeToastEscape,
} from './utils/focusRecovery'
import { useFocusRecovery } from './hooks/useFocusRecovery'

const emitBrowserShortcutHandled = (action: BrowserShortcutAction): boolean => {
  emitBrowserShortcut(action)
  return true
}

function App() {
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const terminals = useProjectStore((s) => s.terminals)
  const toggleFileExplorer = useProjectStore((s) => s.toggleFileExplorer)
  const setFileExplorerVisible = useProjectStore((s) => s.setFileExplorerVisible)
  const setFileExplorerActiveTab = useProjectStore((s) => s.setFileExplorerActiveTab)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)
  const settingsDialogOpen = useProjectStore((s) => s.settingsDialogOpen)
  const setSettingsDialogOpen = useProjectStore((s) => s.setSettingsDialogOpen)
  const closeEditorTab = useProjectStore((s) => s.closeEditorTab)
  const hasActiveTerminals = Object.keys(terminals).length > 0
  const api = useMemo(() => getElectronAPI(), [])

  // Feed the notch strip window with the cross-project agent-session snapshot.
  useNotchFeed()

  // Refocus the active terminal's xterm textarea (e.g. after closing dialogs)
  const refocusActiveTerminal = useCallback(() => {
    requestAnimationFrame(() => focusActiveChatTerminal())
  }, [])

  // Generic focus dead-end recovery (focus fell back to <body>), window-focus
  // restore, webview→host focus handoff and the stray-file-drop guard.
  useFocusRecovery()

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

  // Return to a session when clicked in the notch strip.
  useEffect(() => {
    return api.notch.onActivateTerminal((terminalId) => {
      useProjectStore.getState().setActiveTerminal(terminalId)
    })
  }, [api])

  // Sync the notch toggle when the strip's hide button turns it off.
  useEffect(() => {
    return api.notch.onEnabled((enabled) => {
      useProjectStore.getState().setNotchEnabled(enabled)
    })
  }, [api])

  // Helper to get visual order of projects (pinned → active → inactive)
  // When inactiveSectionCollapsed, inactive projects are skipped from keyboard navigation
  const getProjectVisualOrder = useCallback(() => {
    const { projects, terminals, inactiveSectionCollapsed } = useProjectStore.getState()
    if (projects.length === 0) return []

    const terminalValues = Object.values(terminals)
    const pinned = projects.filter((p) => p.pinned)
    const unpinned = projects.filter((p) => !p.pinned)
    const activeUnpinned = unpinned.filter((p) => terminalValues.some((t) => t.projectId === p.id))
    if (inactiveSectionCollapsed) {
      return [...pinned, ...activeUnpinned]
    }
    const inactiveUnpinned = unpinned.filter(
      (p) => !terminalValues.some((t) => t.projectId === p.id)
    )
    return [...pinned, ...activeUnpinned, ...inactiveUnpinned]
  }, [])

  // Helper to switch to terminal by index (1-9)
  const switchToTerminal = useCallback((index: number): boolean => {
    const { activeProjectId, getProjectTerminals, setActiveTerminal } = useProjectStore.getState()
    if (!activeProjectId) return false

    const projectTerminals = getProjectTerminals(activeProjectId)
    if (index >= projectTerminals.length) return false
    setActiveTerminal(projectTerminals[index].id)
    return true
  }, [])

  // Shared F2 rename dispatcher. The file explorer wins when it has focus;
  // otherwise the active sidebar project is renamed. Both regions are allowed
  // by the fileExplorer.rename scope (HOTKEY_SCOPES); elsewhere F2 passes through.
  const renameFocusedItem = (): boolean => {
    const store = useProjectStore.getState()
    if (document.querySelector('[data-file-explorer]:focus-within')) {
      if (!store.fileExplorerSelectedPath) return false
      store.startRename(store.fileExplorerSelectedPath)
      return true
    }
    if (document.querySelector('[data-sidebar]:focus-within') && store.activeProjectId) {
      store.startProjectRename(store.activeProjectId)
      return true
    }
    return false
  }

  // Focus the first focusable control inside a region; false when there is none.
  const focusFirstIn = (selector: string): boolean => {
    const focusable = document
      .querySelector(selector)
      ?.querySelector<HTMLElement>('button, [tabindex="0"]')
    if (!focusable) return false
    focusable.focus()
    return true
  }

  // Register all hotkeys. Each handler returns whether it handled the key;
  // false lets the key reach the focused terminal/editor (see useHotkeys).
  useHotkeys({
    // Navigation
    'nav.previousProject': () => {
      const { activeProjectId, setActiveProject } = useProjectStore.getState()
      const visualOrder = getProjectVisualOrder()
      if (visualOrder.length === 0) return false

      const currentIndex = visualOrder.findIndex((p) => p.id === activeProjectId)
      const newIndex = (currentIndex - 1 + visualOrder.length) % visualOrder.length
      setActiveProject(visualOrder[newIndex].id)
      return true
    },

    'nav.nextProject': () => {
      const { activeProjectId, setActiveProject } = useProjectStore.getState()
      const visualOrder = getProjectVisualOrder()
      if (visualOrder.length === 0) return false

      const currentIndex = visualOrder.findIndex((p) => p.id === activeProjectId)
      const newIndex = (currentIndex + 1) % visualOrder.length
      setActiveProject(visualOrder[newIndex].id)
      return true
    },

    'nav.previousTerminal': () => {
      const { activeProjectId, activeTerminalId, getProjectTerminals, setActiveTerminal } =
        useProjectStore.getState()
      if (!activeProjectId) return false

      const projectTerminals = getProjectTerminals(activeProjectId)
      if (projectTerminals.length === 0) return false

      const currentIndex = projectTerminals.findIndex((t) => t.id === activeTerminalId)
      const newIndex = (currentIndex - 1 + projectTerminals.length) % projectTerminals.length
      setActiveTerminal(projectTerminals[newIndex].id)
      return true
    },

    'nav.nextTerminal': () => {
      const { activeProjectId, activeTerminalId, getProjectTerminals, setActiveTerminal } =
        useProjectStore.getState()
      if (!activeProjectId) return false

      const projectTerminals = getProjectTerminals(activeProjectId)
      if (projectTerminals.length === 0) return false

      const currentIndex = projectTerminals.findIndex((t) => t.id === activeTerminalId)
      const newIndex = (currentIndex + 1) % projectTerminals.length
      setActiveTerminal(projectTerminals[newIndex].id)
      return true
    },

    'nav.focusSidebar': () => focusFirstIn('[data-sidebar]'),

    'nav.focusTerminal': () => {
      const textarea = document.querySelector<HTMLElement>(ACTIVE_CHAT_TEXTAREA_SELECTOR)
      if (!textarea) return false
      textarea.focus()
      return true
    },

    'nav.focusFileExplorer': () => {
      // Open file explorer if closed, then focus
      const { fileExplorerVisible, setFileExplorerVisible } = useProjectStore.getState()
      if (!fileExplorerVisible) {
        setFileExplorerVisible(true)
      }
      // Focus the file explorer once it is visible
      setTimeout(() => focusFirstIn('[data-file-explorer]'), 50)
      return true
    },

    'nav.projectOverview': () => {
      const { activeProjectId, setProjectOverviewVisible } = useProjectStore.getState()
      if (!activeProjectId) return false
      setProjectOverviewVisible(true)
      return true
    },

    // Terminal operations
    'terminal.new': () => {
      const { activeProjectId, getProjectTerminals, addTerminal, projects } =
        useProjectStore.getState()
      if (!activeProjectId) return false

      const projectTerminals = getProjectTerminals(activeProjectId)
      if (projectTerminals.length >= MAX_TERMINALS_PER_PROJECT) {
        api.notification.show(
          'Chat Limit',
          `Maximum ${MAX_TERMINALS_PER_PROJECT} chats per project`
        )
        return true
      }

      // Use the project's default agent for keyboard-created chats.
      const agent = projects.find((p) => p.id === activeProjectId)?.settings?.defaultAgent ?? 'claude'

      ;(async () => {
        const terminalId = await api.terminal.create(activeProjectId, undefined, agent)
        if (!terminalId) return // spawn-failed event surfaces the error to the user
        const terminal: TerminalSession = {
          id: terminalId,
          projectId: activeProjectId,
          worktreeId: null,
          state: 'busy',
          lastActivity: Date.now(),
          title: `Chat ${projectTerminals.length + 1}`,
          type: agent,
        }
        addTerminal(terminal)
      })()
      return true
    },

    // Scoped away from the shell drawer and the browser pane (HOTKEY_SCOPES):
    // Ctrl+W is delete-word in a sidecar shell. Closes without confirmation.
    'terminal.close': () => {
      const { activeProjectId, activeTerminalId, removeTerminal } = useProjectStore.getState()
      if (!activeProjectId || !activeTerminalId) return false

      api.terminal.close(activeTerminalId)
      removeTerminal(activeTerminalId)
      return true
    },

    // Terminal shortcuts Alt+1-9 (generated handlers)
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`terminal.goTo${i + 1}`, () => switchToTerminal(i)])
    ),

    // File explorer
    'fileExplorer.toggle': () => {
      toggleFileExplorer()
      return true
    },
    'fileExplorer.filesTab': () => {
      setFileExplorerVisible(true)
      setFileExplorerActiveTab('files')
      return true
    },
    'fileExplorer.gitTab': () => {
      setFileExplorerVisible(true)
      setFileExplorerActiveTab('git')
      return true
    },
    'fileExplorer.tasksTab': () => {
      setFileExplorerVisible(true)
      setFileExplorerActiveTab('tasks')
      return true
    },
    'automations.showOverview': () => {
      useProjectStore.getState().setAutomationsOverviewVisible(true)
      return true
    },
    // newFile/newFolder/delete/copyPath only fire with focus in the explorer
    // (HOTKEY_SCOPES), so the explorer is visible by construction.
    'fileExplorer.newFile': () => {
      const { activeProjectId, projects, fileExplorerSelectedPath } = useProjectStore.getState()
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      // Determine parent: selected directory or project root
      const parentPath = fileExplorerSelectedPath ?? project.path
      useProjectStore.getState().startCreate(parentPath, 'file')
      return true
    },
    'fileExplorer.newFolder': () => {
      const { activeProjectId, projects, fileExplorerSelectedPath } = useProjectStore.getState()
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      const parentPath = fileExplorerSelectedPath ?? project.path
      useProjectStore.getState().startCreate(parentPath, 'directory')
      return true
    },
    'fileExplorer.rename': renameFocusedItem,
    'fileExplorer.delete': () => {
      const { fileExplorerSelectedPath, directoryCache } = useProjectStore.getState()
      if (!fileExplorerSelectedPath) return false
      // Find the entry in the cache
      for (const entries of Object.values(directoryCache)) {
        const found = entries.find((e) => e.path === fileExplorerSelectedPath)
        if (found) {
          useProjectStore.getState().setDeletingEntry(found)
          return true
        }
      }
      return false
    },
    'fileExplorer.copyPath': () => {
      const { fileExplorerSelectedPath } = useProjectStore.getState()
      if (!fileExplorerSelectedPath) return false
      navigator.clipboard.writeText(fileExplorerSelectedPath)
      return true
    },

    // Git operations — scoped to focus within the explorer flyout, and only
    // while its git tab is showing.
    'git.stageAll': () => {
      const { activeProjectId, projects, gitStatus, fileExplorerActiveTab } =
        useProjectStore.getState()
      if (fileExplorerActiveTab !== 'git') return false
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      const status = gitStatus[project.id]
      if (!status) return false
      const files = [...status.modified.map((f) => f.path), ...status.untracked.map((f) => f.path)]
      if (files.length > 0) {
        api.git.stageFiles(project.path, files).then(() => {
          // Trigger refresh via the git tab's existing refresh mechanism
        })
      }
      return true
    },
    'git.unstageAll': () => {
      const { activeProjectId, projects, gitStatus, fileExplorerActiveTab } =
        useProjectStore.getState()
      if (fileExplorerActiveTab !== 'git') return false
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      const status = gitStatus[project.id]
      if (!status) return false
      const files = status.staged.map((f) => f.path)
      if (files.length > 0) {
        api.git.unstageFiles(project.path, files).then(() => {
          // Refresh handled by file watcher
        })
      }
      return true
    },
    'git.commit': () => {
      // Focus the commit textarea when git tab is active
      const { fileExplorerActiveTab } = useProjectStore.getState()
      if (fileExplorerActiveTab !== 'git') return false
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-git-commit-input]')
      if (!textarea) return false
      textarea.focus()
      return true
    },
    'git.discardAll': () => {
      const { activeProjectId, projects, gitStatus, fileExplorerActiveTab, setDiscardingFiles } =
        useProjectStore.getState()
      if (fileExplorerActiveTab !== 'git') return false
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      const status = gitStatus[project.id]
      if (!status) return false
      const files = status.modified.map((f) => f.path)
      if (files.length > 0) {
        setDiscardingFiles({ files, isUntracked: false })
      }
      return true
    },

    // Editor
    'editor.closeTab': () => {
      const { activeTerminalId, activeContentTabId, editorTabs } = useProjectStore.getState()
      const tabId = activeContentTabId[activeTerminalId ?? '']
      if (!tabId || !editorTabs[tabId]) return false
      closeEditorTab(tabId)
      return true
    },
    'editor.nextTab': () => {
      const { editorTabs, activeTerminalId, activeContentTabId, setActiveContentTab } =
        useProjectStore.getState()
      const chatId = activeTerminalId ?? ''
      const tabs = Object.values(editorTabs).filter((t) => t.terminalId === chatId)
      if (tabs.length === 0) return false

      const currentIndex = tabs.findIndex((t) => t.id === activeContentTabId[chatId])
      const nextIndex = (currentIndex + 1) % tabs.length
      setActiveContentTab(tabs[nextIndex].id)
      return true
    },
    'editor.previousTab': () => {
      const { editorTabs, activeTerminalId, activeContentTabId, setActiveContentTab } =
        useProjectStore.getState()
      const chatId = activeTerminalId ?? ''
      const tabs = Object.values(editorTabs).filter((t) => t.terminalId === chatId)
      if (tabs.length === 0) return false

      const currentIndex = tabs.findIndex((t) => t.id === activeContentTabId[chatId])
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
      setActiveContentTab(tabs[prevIndex].id)
      return true
    },
    'editor.save': () => {
      // Editor save is handled by CodeEditor component via Monaco
      // This is a fallback that triggers the active editor's save
      const event = new CustomEvent('editor-save-request')
      window.dispatchEvent(event)
      return true
    },
    'browser.open': () => {
      const { activeProjectId, openBrowserTab } = useProjectStore.getState()
      if (!activeProjectId) return false
      openBrowserTab(activeProjectId)
      return true
    },
    'shell.toggle': () => {
      useProjectStore.getState().toggleShellDrawer()
      return true
    },

    // Sidebar
    'sidebar.toggleInactive': () => {
      useProjectStore.getState().toggleInactiveSectionCollapsed()
      return true
    },

    // Toggle collapse of the active project. Binding resolution in useHotkeys
    // falls back to DEFAULT_HOTKEY_CONFIG for persisted configs that predate
    // this action (same fallback pattern as dialog.dismissTopmostToast).
    'sidebar.toggleProjectCollapse': () => {
      const { activeProjectId, toggleProjectCollapsed } = useProjectStore.getState()
      if (!activeProjectId) return false
      toggleProjectCollapsed(activeProjectId)
      return true
    },

    'sidebar.pinProject': () => {
      const { activeProjectId, togglePinProject } = useProjectStore.getState()
      if (!activeProjectId) return false
      togglePinProject(activeProjectId)
      return true
    },

    'sidebar.toggleInactiveWorktrees': () => {
      const { activeProjectId, toggleInactiveWorktrees } = useProjectStore.getState()
      if (!activeProjectId) return false
      toggleInactiveWorktrees(activeProjectId)
      return true
    },

    'sidebar.toggleProjectType': () => {
      const { activeProjectId, projects, updateProject } = useProjectStore.getState()
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      updateProject(project.id, { type: project.type === 'code' ? 'project' : 'code' })
      return true
    },

    // UI & Settings
    'ui.openSettings': () => {
      setSettingsDialogOpen(true)
      return true
    },
    'ui.toggleTheme': () => {
      toggleTheme()
      return true
    },
    'ui.showShortcuts': () => {
      setShowShortcuts(true)
      return true
    },
    'ui.cycleClaudeMode': () => {
      const { activeProjectId, projects, updateProject } = useProjectStore.getState()
      const project = projects.find((p) => p.id === activeProjectId)
      if (!project) return false
      const currentMode = project.settings?.claudeMode ?? 'chat'
      const modeOrder = ['chat', 'auto', 'full-auto'] as const
      const nextMode = modeOrder[(modeOrder.indexOf(currentMode) + 1) % modeOrder.length]
      updateProject(project.id, { settings: { ...project.settings, claudeMode: nextMode } })
      return true
    },
    'ui.toggleUsageIndicator': () => {
      useProjectStore.getState().toggleUsageIndicator()
      return true
    },
    'ui.toggleNotch': () => {
      useProjectStore.getState().toggleNotchEnabled()
      return true
    },

    // Browser shortcuts, app-chrome-focus path — scoped to focus within the
    // browser pane (HOTKEY_SCOPES), so Ctrl+F (etc.) reach the chat/editor
    // everywhere else. When the webview guest itself has focus these are
    // intercepted in the main process instead (forwarded via the effect below).
    'browser.zoomIn': () => emitBrowserShortcutHandled('browser.zoomIn'),
    'browser.zoomOut': () => emitBrowserShortcutHandled('browser.zoomOut'),
    'browser.zoomReset': () => emitBrowserShortcutHandled('browser.zoomReset'),
    'browser.find': () => emitBrowserShortcutHandled('browser.find'),
    'browser.hardReload': () => emitBrowserShortcutHandled('browser.hardReload'),
  })

  // Close dialog with Escape
  useDialogHotkeys(
    () => setShowCloseDialog(false),
    () => {}, // Don't confirm close on Enter
    { enabled: showCloseDialog, canConfirm: false }
  )

  // Forward browser shortcuts intercepted in the main process (pressed while the
  // <webview> guest had focus, so they never reached this renderer's keydown)
  // onto the shortcut bus, where the active browser tab handles them.
  useEffect(() => {
    return api.browser.onShortcut((action) => {
      if (isBrowserShortcutAction(action)) emitBrowserShortcut(action)
    })
  }, [api])

  // Escape → dismiss topmost toast (if any) BEFORE dialog-close handlers run.
  // A direct listener (capture, registered in useEffect) is used because the
  // generic useHotkeys flow would unconditionally consume Escape, breaking
  // dialog close when no toast is on screen. Here we only consume the key if
  // a toast actually existed; otherwise we let downstream listeners proceed.
  // Reads binding from the persisted hotkey config so user re-bindings apply.
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG
  const dismissBindingRef = useRef(
    hotkeyConfig['dialog.dismissTopmostToast'] ??
      DEFAULT_HOTKEY_CONFIG['dialog.dismissTopmostToast']
  )
  dismissBindingRef.current =
    hotkeyConfig['dialog.dismissTopmostToast'] ??
    DEFAULT_HOTKEY_CONFIG['dialog.dismissTopmostToast']

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesBinding(e, dismissBindingRef.current)) return
      if (!dismissTopmostToast()) return
      // In a terminal Esc is also Claude Code's interrupt: the toast is gone,
      // but the key must still reach xterm.
      if (!shouldConsumeToastEscape(e.target)) return
      // A toast was consumed — stop dialog-close and any other Escape handlers
      // on this same press from firing.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    // Capture phase so this runs before useHotkeys / useDialogHotkeys listeners
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])

  // Resolve theme preference (system/light/dark) → apply to DOM + sync to Claude Code
  useThemeResolver()

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
        onClose={() => {
          setSettingsDialogOpen(false)
          refocusActiveTerminal()
        }}
      />

      {/* Shortcuts Overlay */}
      <ShortcutsOverlay
        isOpen={showShortcuts}
        onClose={() => {
          setShowShortcuts(false)
          refocusActiveTerminal()
        }}
      />

      {/* Close Confirmation Dialog */}
      {showCloseDialog && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div className="bg-sidebar border border-border rounded-xl max-w-md mx-4 shadow-2xl">
            <div className="px-5 py-3 border-b border-border/30 bg-sidebar-accent/30 rounded-t-xl">
              <h2 className="text-sm font-semibold text-foreground">Close Application?</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground">
                You have {Object.keys(terminals).length} active terminal
                {Object.keys(terminals).length > 1 ? 's' : ''}. Closing the application will
                terminate all running sessions.
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
