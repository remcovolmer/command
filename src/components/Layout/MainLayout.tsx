import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from '../Sidebar/Sidebar'
import { TerminalArea } from './TerminalArea'
import { FileExplorer } from '../FileExplorer/FileExplorer'
import { ActivityRail } from './ActivityRail'
import { UpdateNotification } from '../UpdateNotification'
import { SpawnErrorToast } from '../notifications/SpawnErrorToast'
import { UncaughtErrorToast } from '../notifications/UncaughtErrorToast'
import { useProjectStore } from '../../stores/projectStore'

export function MainLayout() {
  const fileExplorerVisible = useProjectStore((s) => s.fileExplorerVisible)
  const setFileExplorerVisible = useProjectStore((s) => s.setFileExplorerVisible)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Auto-close the flyout on click outside (ignoring the rail, which toggles it).
  useEffect(() => {
    if (!fileExplorerVisible) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (overlayRef.current?.contains(target)) return
      const rail = document.querySelector('[data-activity-rail]')
      if (rail?.contains(target)) return
      setFileExplorerVisible(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [fileExplorerVisible, setFileExplorerVisible])

  return (
    <div className="h-screen w-screen bg-background flex">
      <UpdateNotification />
      <SpawnErrorToast />
      <UncaughtErrorToast />

      <div className="flex-1 min-w-0 relative">
        <PanelGroup direction="horizontal" autoSaveId="main-layout-v2">
          {/* Sidebar */}
          <Panel id="sidebar" defaultSize={22} minSize={15} maxSize={35} className="bg-sidebar">
            <Sidebar />
          </Panel>

          <PanelResizeHandle className="w-1 transition-colors" />

          {/* Center: chat column + second panel (TerminalArea owns the inner split) */}
          <Panel id="center" defaultSize={78} minSize={40}>
            <TerminalArea />
          </Panel>
        </PanelGroup>

        {/* File-explorer flyout — always mounted (preserves git watchers), shown via
            visibility so xterm/Monaco geometry stays valid (never display:none). */}
        <div
          ref={overlayRef}
          className="absolute top-0 right-0 bottom-0 w-[340px] bg-sidebar border-l border-border shadow-2xl z-40"
          style={{
            visibility: fileExplorerVisible ? 'visible' : 'hidden',
            pointerEvents: fileExplorerVisible ? 'auto' : 'none',
            transform: fileExplorerVisible ? 'translateX(0)' : 'translateX(12px)',
            transition: 'transform 120ms ease',
          }}
        >
          <FileExplorer />
        </div>
      </div>

      <ActivityRail />
    </div>
  )
}
