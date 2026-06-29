import { useMemo, useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels'
import { useProjectStore, MAX_TERMINALS_PER_PROJECT } from '../../stores/projectStore'
import { TerminalTabBar } from '../Terminal/TerminalTabBar'
import { TerminalViewport } from '../Terminal/TerminalViewport'
import { SecondPanel } from './SecondPanel'
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
    editorTabs,
    activeContentTabId,
    projectOverviewVisible,
    setActiveTerminal,
    removeTerminal,
    setActiveContentTab,
    closeEditorTab,
    addTerminal,
  } = useProjectStore(
    useShallow((s) => ({
      activeProjectId: s.activeProjectId,
      activeTerminalId: s.activeTerminalId,
      terminals: s.terminals,
      projects: s.projects,
      editorTabs: s.editorTabs,
      activeContentTabId: s.activeContentTabId,
      projectOverviewVisible: s.projectOverviewVisible,
      setActiveTerminal: s.setActiveTerminal,
      removeTerminal: s.removeTerminal,
      setActiveContentTab: s.setActiveContentTab,
      closeEditorTab: s.closeEditorTab,
      addTerminal: s.addTerminal,
    }))
  )

  const { createTerminal } = useCreateTerminal()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  const projectTerminals = useMemo(
    () =>
      Object.values(terminals).filter(
        (t) => t.projectId === activeProjectId && t.type !== 'normal'
      ),
    [terminals, activeProjectId]
  )

  // Content tabs (editors/diffs) scoped to the active chat — the second panel.
  const chatContentTabs = useMemo(
    () => Object.values(editorTabs).filter((t) => t.terminalId === activeTerminalId),
    [editorTabs, activeTerminalId]
  )
  const activeContentId = activeTerminalId ? (activeContentTabId[activeTerminalId] ?? null) : null

  // Collapse the second panel when the active chat has no open content.
  const secondPanelRef = useRef<ImperativePanelHandle>(null)
  useEffect(() => {
    const panel = secondPanelRef.current
    if (!panel) return
    if (chatContentTabs.length > 0) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [chatContentTabs.length])

  const handleCreateTerminal = async () => {
    if (!activeProjectId) return
    await createTerminal(activeProjectId, {
      onCreated: (terminalId) => setActiveTerminal(terminalId),
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
    },
    [setActiveTerminal]
  )

  const handleSelectContent = useCallback(
    (tabId: string) => {
      setActiveContentTab(tabId)
    },
    [setActiveContentTab]
  )

  const handleCloseContent = useCallback(
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

  const handleResumeSession = useCallback(
    async (sessionId: string, initialTitle?: string) => {
      if (!activeProjectId) return
      const terminalId = await api.terminal.create(activeProjectId, undefined, 'claude', sessionId)
      if (terminalId) {
        addTerminal({
          id: terminalId,
          projectId: activeProjectId,
          worktreeId: null,
          state: 'busy',
          lastActivity: Date.now(),
          title: initialTitle || 'Resuming...',
          type: 'claude',
        })
      }
    },
    [activeProjectId, api, addTerminal]
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
          <h2 className="text-2xl font-semibold text-foreground mb-3">Welcome to Command</h2>
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

  // Show project overview when there are no chats, or when explicitly toggled on.
  const showOverview = projectTerminals.length === 0 || projectOverviewVisible
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

  const hasContent = chatContentTabs.length > 0

  return (
    <PanelGroup direction="horizontal" autoSaveId="center-split">
      {/* Chat column — always visible */}
      <Panel id="chat-col" defaultSize={55} minSize={25}>
        <div className="h-full w-full flex flex-col bg-sidebar">
          <TerminalTabBar
            terminals={projectTerminals}
            activeTerminalId={activeTerminalId}
            onSelect={handleSelectTerminal}
            onClose={handleCloseTerminal}
            onAdd={handleCreateTerminal}
            canAdd={projectTerminals.length < MAX_TERMINALS_PER_PROJECT}
          />
          <div className="flex-1 min-h-0">
            <TerminalViewport terminals={projectTerminals} activeTerminalId={activeTerminalId} />
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className={`w-1 transition-colors ${!hasContent ? 'hidden' : ''}`} />

      {/* Second panel — opened files + browser, scoped to the active chat */}
      <Panel
        ref={secondPanelRef}
        id="second-panel"
        defaultSize={45}
        minSize={20}
        collapsible
        collapsedSize={0}
      >
        <SecondPanel
          tabs={chatContentTabs}
          activeContentId={activeContentId}
          onSelect={handleSelectContent}
          onClose={handleCloseContent}
        />
      </Panel>
    </PanelGroup>
  )
}
