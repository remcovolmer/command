import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { TerminalArea } from './TerminalArea'
import { FileExplorer } from '../FileExplorer/FileExplorer'
import { UpdateNotification } from '../UpdateNotification'
import { useProjectStore } from '../../stores/projectStore'

export function MainLayout() {
  const fileExplorerVisible = useProjectStore((s) => s.fileExplorerVisible)
  const fileExplorerRef = useRef<ImperativePanelHandle>(null)

  // Sync panel collapse state with store
  useEffect(() => {
    const panel = fileExplorerRef.current
    if (!panel) return

    if (fileExplorerVisible) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [fileExplorerVisible])

  return (
    <div className="h-screen w-screen bg-background">
      <UpdateNotification />
      <PanelGroup direction="horizontal" autoSaveId="main-layout">
        {/* Sidebar */}
        <Panel
          id="sidebar"
          defaultSize={20}
          minSize={15}
          maxSize={35}
          className="bg-sidebar"
        >
          <Sidebar />
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-1 bg-border hover:bg-primary transition-colors" />

        {/* Terminal Area */}
        <Panel id="terminals" defaultSize={60} minSize={30}>
          <TerminalArea />
        </Panel>

        {/* Resize Handle for File Explorer */}
        <PanelResizeHandle className={`w-1 bg-border hover:bg-primary transition-colors ${!fileExplorerVisible ? 'hidden' : ''}`} />

        {/* File Explorer (always rendered, but collapsible) */}
        <Panel
          ref={fileExplorerRef}
          id="file-explorer"
          defaultSize={20}
          minSize={15}
          maxSize={35}
          collapsible
          collapsedSize={0}
          className="bg-sidebar"
        >
          <FileExplorer />
        </Panel>
      </PanelGroup>
    </div>
  )
}
