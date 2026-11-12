import { useMemo, useCallback, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  useProjectStore,
  MAX_TERMINALS_PER_PROJECT,
  getVisibleTerminals,
} from '../../stores/projectStore'
import { getMountedChats, getViewportActiveTerminalId } from '../../utils/terminalMounting'
import { TerminalTabBar } from '../Terminal/TerminalTabBar'
import { StateLine } from '../Terminal/StateLine'
import { TerminalViewport } from '../Terminal/TerminalViewport'
import { SecondPanel } from './SecondPanel'
import { ProjectOverview } from '../ProjectOverview'
import { AutomationsOverview } from '../Automations/AutomationsOverview'
import { getElectronAPI } from '../../utils/electron'
import { estimateTerminalGrid } from '../../utils/terminalGrid'
import { useCreateTerminal } from '../../hooks/useCreateTerminal'
import { LogoIcon } from '../LogoIcon'
import { DEFAULT_HOTKEY_CONFIG, formatBinding } from '../../utils/hotkeys'
import { kbd } from '../ui/controls'

export function TerminalArea() {
  const api = useMemo(() => getElectronAPI(), [])
  const {
    activeProjectId,
    activeTerminalId,
    terminals,
    worktrees,
    sidecarTerminals,
    projects,
    editorTabs,
    activeContentTabId,
    projectOverviewVisible,
    automationsOverviewVisible,
    hotkeyConfig,
    setActiveTerminal,
    removeTerminal,
    setActiveContentTab,
    closeEditorTab,
    setBrowserTabUrl,
    addTerminal,
  } = useProjectStore(
    useShallow((s) => ({
      activeProjectId: s.activeProjectId,
      activeTerminalId: s.activeTerminalId,
      terminals: s.terminals,
      worktrees: s.worktrees,
      sidecarTerminals: s.sidecarTerminals,
      projects: s.projects,
      editorTabs: s.editorTabs,
      activeContentTabId: s.activeContentTabId,
      projectOverviewVisible: s.projectOverviewVisible,
      automationsOverviewVisible: s.automationsOverviewVisible,
      hotkeyConfig: s.hotkeyConfig ?? DEFAULT_HOTKEY_CONFIG,
      setActiveTerminal: s.setActiveTerminal,
      removeTerminal: s.removeTerminal,
      setActiveContentTab: s.setActiveContentTab,
      closeEditorTab: s.closeEditorTab,
      setBrowserTabUrl: s.setBrowserTabUrl,
      addTerminal: s.addTerminal,
    }))
  )

  const { createTerminal } = useCreateTerminal()

  const activeProject = projects.find((p) => p.id === activeProjectId)
  // Tabs share the sidebar's canonical order via getVisibleTerminals, so
  // left-to-right in the tab bar matches top-to-bottom in the sidebar.
  const projectTerminals = useMemo(
    () =>
      activeProjectId
        ? getVisibleTerminals(terminals, worktrees, sidecarTerminals, activeProjectId)
        : [],
    [terminals, worktrees, sidecarTerminals, activeProjectId]
  )

  // Every chat of every project stays mounted (hidden unless active), so a
  // project switch or an overview never tears down a live xterm: its screen,
  // scrollback and terminal modes survive and no PTY output is dropped. The
  // LRU pool bounds how many of them hold a live xterm.
  const mountedChats = useMemo(
    () => getMountedChats(terminals, sidecarTerminals),
    [terminals, sidecarTerminals]
  )

  // Content tabs (editors/diffs) scoped to the active chat — the second panel.
  const chatContentTabs = useMemo(
    () => Object.values(editorTabs).filter((t) => t.terminalId === activeTerminalId),
    [editorTabs, activeTerminalId]
  )
  const activeContentId = activeTerminalId ? (activeContentTabId[activeTerminalId] ?? null) : null

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
      const terminalId = await api.terminal.create(
        activeProjectId,
        undefined,
        'claude',
        sessionId,
        undefined,
        estimateTerminalGrid('chat', activeTerminalId)
      )
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
    [activeProjectId, activeTerminalId, api, addTerminal]
  )

  // Show project overview when there are no chats, or when explicitly toggled on.
  const showOverview = projectTerminals.length === 0 || projectOverviewVisible

  // Whatever covers the chat column. The chat column itself stays mounted
  // underneath (visibility:hidden, like inactive chats) so its xterms survive.
  let overlay: ReactNode = null
  if (automationsOverviewVisible) {
    // Global automations overview: independent of the active project (R3, R5, AE5).
    // Checked before the no-project branch so it shows regardless of selection.
    overlay = <AutomationsOverview />
  } else if (!activeProjectId || !activeProject) {
    // No project selected - show welcome
    const newChatBinding = hotkeyConfig['terminal.new']
    const shortcutsBinding = hotkeyConfig['ui.showShortcuts']

    overlay = (
      <div className="flex flex-col items-center justify-center h-full bg-screen">
        <div className="text-center max-w-md mx-auto px-8">
          <LogoIcon className="w-10 h-10 text-primary mx-auto mb-4" />
          <h2 className="text-[22px] font-semibold text-fg-strong mb-2">Command</h2>
          <p className="text-[13px] text-fg-muted mb-6">
            Kies links een project, of voeg er een toe.
          </p>
          <div className="flex flex-col items-center gap-1.5 font-mono text-[11.5px] text-fg-muted">
            <div className="flex items-center gap-2">
              <kbd className={kbd}>+</kbd>
              <span>Add project</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className={kbd}>{formatBinding(newChatBinding)}</kbd>
              <span>New chat</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className={kbd}>{formatBinding(shortcutsBinding)}</kbd>
              <span>Shortcuts</span>
            </div>
          </div>
        </div>
      </div>
    )
  } else if (showOverview) {
    overlay = (
      <ProjectOverview
        projectId={activeProjectId}
        projectName={activeProject.name}
        projectPath={activeProject.path}
        onCreateTerminal={handleCreateTerminal}
        onResumeSession={handleResumeSession}
      />
    )
  }

  const chatsVisible = overlay === null
  // Only a chat of the active project, with nothing covering it, is active
  // (focus, fit, pool protection); everything else is mounted but hidden.
  const viewportActiveId = getViewportActiveTerminalId(
    terminals,
    activeTerminalId,
    activeProjectId,
    chatsVisible
  )
  const hasContent = chatsVisible && chatContentTabs.length > 0

  return (
    <div className="relative h-full w-full">
      <div
        className="absolute inset-0"
        style={{
          visibility: chatsVisible ? 'visible' : 'hidden',
          pointerEvents: chatsVisible ? 'auto' : 'none',
        }}
        aria-hidden={!chatsVisible}
      >
        <PanelGroup direction="horizontal" autoSaveId="center-split">
          {/* Chat column — always visible; fills the width when nothing is open */}
          <Panel id="chat-col" order={1} defaultSize={55} minSize={25}>
            <div className="h-full w-full flex flex-col bg-screen">
              <TerminalTabBar
                terminals={projectTerminals}
                activeTerminalId={activeTerminalId}
                onSelect={handleSelectTerminal}
                onClose={handleCloseTerminal}
                onAdd={handleCreateTerminal}
                canAdd={projectTerminals.length < MAX_TERMINALS_PER_PROJECT}
              />
              <StateLine
                state={activeTerminalId ? (terminals[activeTerminalId]?.state ?? null) : null}
              />
              <div className="flex-1 min-h-0" data-terminal-viewport="chat">
                <TerminalViewport terminals={mountedChats} activeTerminalId={viewportActiveId} />
              </div>
            </div>
          </Panel>

          {/* Second panel — only mounted when the active chat has open content,
              so the chat column fills the full width otherwise. */}
          {hasContent && (
            <>
              <PanelResizeHandle className="w-1 transition-colors" />
              <Panel id="second-panel" order={2} defaultSize={45} minSize={20}>
                <SecondPanel
                  tabs={chatContentTabs}
                  activeContentId={activeContentId}
                  onSelect={handleSelectContent}
                  onClose={handleCloseContent}
                  onBrowserUrlChange={setBrowserTabUrl}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      {overlay && <div className="absolute inset-0">{overlay}</div>}
    </div>
  )
}
