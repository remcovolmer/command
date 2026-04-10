import { useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import { TerminalTabBar } from '../Terminal/TerminalTabBar'
import { TerminalViewport } from '../Terminal/TerminalViewport'
import { ProjectOverview } from '../ProjectOverview'
import { TerminalIcon, Plus, Sparkles } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import { useCreateTerminal } from '../../hooks/useCreateTerminal'

export function TerminalArea() {
  const api = useMemo(() => getElectronAPI(), [])
  const {
    activeProjectId,
    activeTerminalId,
    terminals,
    projects,
    layouts,
    editorTabs,
    activeCenterTabId,
    setActiveTerminal,
    removeTerminal,
    addToSplit,
    removeFromSplit,
    setSplitSizes,
    setActiveCenterTab,
    closeEditorTab,
  } = useProjectStore(useShallow((s) => ({
    activeProjectId: s.activeProjectId,
    activeTerminalId: s.activeTerminalId,
    terminals: s.terminals,
    projects: s.projects,
    layouts: s.layouts,
    editorTabs: s.editorTabs,
    activeCenterTabId: s.activeCenterTabId,
    setActiveTerminal: s.setActiveTerminal,
    removeTerminal: s.removeTerminal,
    addToSplit: s.addToSplit,
    removeFromSplit: s.removeFromSplit,
    setSplitSizes: s.setSplitSizes,
    setActiveCenterTab: s.setActiveCenterTab,
    closeEditorTab: s.closeEditorTab,
  })))

  const { createTerminal } = useCreateTerminal()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectTerminals = useMemo(
    () => Object.values(terminals).filter(
      (t) => t.projectId === activeProjectId && t.type !== 'normal'
    ),
    [terminals, activeProjectId]
  )

  // Get editor tabs for the active project
  const projectEditorTabs = useMemo(
    () => Object.values(editorTabs).filter(
      (t) => t.projectId === activeProjectId
    ),
    [editorTabs, activeProjectId]
  )

  // Get current layout for the project
  const currentLayout = activeProjectId ? layouts[activeProjectId] : null
  const splitTerminalIds = currentLayout?.splitTerminalIds ?? []

  const handleCreateTerminal = async () => {
    if (!activeProjectId) return

    await createTerminal(activeProjectId, {
      onCreated: (terminalId) => setActiveCenterTab(terminalId),
    })
  }

  const handleCloseTerminal = useCallback(
    async (terminalId: string) => {
      api.terminal.close(terminalId)
      removeTerminal(terminalId)
    },
    [api, removeTerminal]
  )

  const handleSelectTerminal = useCallback(
    (terminalId: string) => {
      setActiveTerminal(terminalId)
      setActiveCenterTab(terminalId)
    },
    [setActiveTerminal, setActiveCenterTab]
  )

  const handleSelectEditor = useCallback(
    (tabId: string) => {
      setActiveCenterTab(tabId)
    },
    [setActiveCenterTab]
  )

  const handleCloseEditor = useCallback(
    (tabId: string) => {
      const tab = editorTabs[tabId]
      if (tab?.type === 'editor' && tab.isDirty) {
        if (!window.confirm(`"${tab.fileName}" has unsaved changes. Close anyway?`)) {
          return
        }
      }
      closeEditorTab(tabId)
    },
    [editorTabs, closeEditorTab]
  )

  const handleUnsplit = useCallback(
    (terminalId: string) => {
      if (!activeProjectId) return
      removeFromSplit(activeProjectId, terminalId)
    },
    [activeProjectId, removeFromSplit]
  )

  const handleDropToSplit = useCallback(
    (terminalId: string, position: 'left' | 'right') => {
      if (!activeProjectId) return

      // If there's already a split, just add to it
      if (splitTerminalIds.length >= 2) {
        addToSplit(activeProjectId, terminalId)
        return
      }

      // Find a terminal to pair with (either the active one, or another one)
      let pairTerminalId: string | null = null

      if (activeTerminalId && activeTerminalId !== terminalId) {
        pairTerminalId = activeTerminalId
      } else {
        const otherTerminal = projectTerminals.find(t => t.id !== terminalId)
        pairTerminalId = otherTerminal?.id ?? null
      }

      if (pairTerminalId) {
        if (position === 'left') {
          addToSplit(activeProjectId, terminalId)
          addToSplit(activeProjectId, pairTerminalId)
        } else {
          addToSplit(activeProjectId, pairTerminalId)
          addToSplit(activeProjectId, terminalId)
        }
      }
    },
    [activeProjectId, activeTerminalId, projectTerminals, splitTerminalIds.length, addToSplit]
  )

  const handleSplitSizesChange = useCallback(
    (sizes: number[]) => {
      if (activeProjectId) {
        setSplitSizes(activeProjectId, sizes)
      }
    },
    [activeProjectId, setSplitSizes]
  )

  // No project selected - show welcome
  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background">
        <div className="text-center max-w-md mx-auto px-8">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 shadow-sm flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3">
            Welcome to Command
          </h2>
          <p className="text-muted-foreground mb-8">
            Select a project from the sidebar to start managing your Claude Code terminals.
          </p>
          <div className="flex items-center justify-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-xs">
              <TerminalIcon className="w-3.5 h-3.5" />
              Multi-terminal support
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-xs">
              <Plus className="w-3.5 h-3.5" />
              Up to {MAX_TERMINALS_PER_PROJECT} per project
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleResumeSession = useCallback(async (sessionId: string) => {
    if (!activeProjectId) return
    const terminalId = await api.terminal.create(activeProjectId, undefined, 'claude', sessionId)
    if (terminalId) {
      const { addTerminal, setActiveCenterTab } = useProjectStore.getState()
      addTerminal({
        id: terminalId,
        projectId: activeProjectId,
        worktreeId: null,
        state: 'busy',
        lastActivity: Date.now(),
        title: 'Resuming...',
        type: 'claude',
      })
      setActiveCenterTab(terminalId)
    }
  }, [activeProjectId, api])

  // Show project overview when: no terminals/editors, OR user explicitly deselected all tabs (hotkey)
  const showOverview = (projectTerminals.length === 0 && projectEditorTabs.length === 0)
    || (!activeCenterTabId && projectTerminals.length > 0)
  if (showOverview) {
    return (
      <ProjectOverview
        projectId={activeProjectId}
        projectName={activeProject.name}
        projectPath={activeProject.path}
        onCreateTerminal={handleCreateTerminal}
        onResumeSession={handleResumeSession}
      />
    )
  }

  // Terminals with tab bar
  return (
    <div className="h-full w-full flex flex-col bg-sidebar">
      <TerminalTabBar
        terminals={projectTerminals}
        editorTabs={projectEditorTabs}
        activeTerminalId={activeTerminalId}
        activeCenterTabId={activeCenterTabId}
        splitTerminalIds={splitTerminalIds}
        onSelectTerminal={handleSelectTerminal}
        onSelectEditor={handleSelectEditor}
        onClose={handleCloseTerminal}
        onCloseEditor={handleCloseEditor}
        onUnsplit={handleUnsplit}
        onAdd={handleCreateTerminal}
        canAdd={projectTerminals.length < MAX_TERMINALS_PER_PROJECT}
      />
      <div className="flex-1 min-h-0">
        <TerminalViewport
          terminals={projectTerminals}
          editorTabs={projectEditorTabs}
          activeTerminalId={activeTerminalId}
          activeCenterTabId={activeCenterTabId}
          splitTerminalIds={splitTerminalIds}
          projectId={activeProjectId!}
          onSplitSizesChange={handleSplitSizesChange}
          onDropToSplit={handleDropToSplit}
          onSelect={handleSelectTerminal}
        />
      </div>
    </div>
  )
}
