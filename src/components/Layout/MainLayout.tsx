import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { TerminalArea } from './TerminalArea'

export function MainLayout() {
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
        <Panel id="terminals" defaultSize={80} minSize={50}>
          <TerminalArea />
        </Panel>
      </PanelGroup>
    </div>
  )
}
