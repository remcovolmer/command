import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { TerminalArea } from './TerminalArea'
import { FileExplorer } from '../FileExplorer/FileExplorer'
import { useProjectStore } from '../../stores/projectStore'

export function MainLayout() {
  const fileExplorerVisible = useProjectStore((s) => s.fileExplorerVisible)

  return (
    <div className="h-screen w-screen bg-claude-main-bg">
      <PanelGroup direction="horizontal" autoSaveId="main-layout">
        {/* Sidebar */}
        <Panel
          id="sidebar"
          defaultSize={20}
          minSize={15}
          maxSize={35}
          className="bg-claude-sidebar-bg"
        >
          <Sidebar />
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle className="w-1 bg-claude-sidebar-border hover:bg-claude-accent-primary transition-colors" />

        {/* Terminal Area */}
        <Panel id="terminals" defaultSize={fileExplorerVisible ? 60 : 80} minSize={30}>
          <TerminalArea />
        </Panel>

        {/* File Explorer (conditional) */}
        {fileExplorerVisible && (
          <>
            <PanelResizeHandle className="w-1 bg-claude-sidebar-border hover:bg-claude-accent-primary transition-colors" />
            <Panel
              id="file-explorer"
              defaultSize={20}
              minSize={15}
              maxSize={35}
              className="bg-claude-sidebar-bg"
            >
              <FileExplorer />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
