import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import type { Project, FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu, type ContextMenuEntry } from '../Sidebar/ContextMenu'
import { isEditableFile } from '../../utils/editorLanguages'
import { getFileIcon, getFolderIcon } from './fileIcons'
import { getParentPath } from '../../utils/paths'

interface FileTreeProps {
  project: Project
}

export function FileTree({ project }: FileTreeProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef<string | null>(null)

  const [contextMenu, setContextMenu] = useState<{
    entry: FileSystemEntry | null
    x: number
    y: number
  } | null>(null)

  const rootEntries = useProjectStore((s) => s.directoryCache[project.path])
  const setDirectoryContents = useProjectStore((s) => s.setDirectoryContents)
  const fileExplorerRenamingPath = useProjectStore((s) => s.fileExplorerRenamingPath)
  const fileExplorerCreating = useProjectStore((s) => s.fileExplorerCreating)
  const startRename = useProjectStore((s) => s.startRename)
  const startCreate = useProjectStore((s) => s.startCreate)
  const setDeletingEntry = useProjectStore((s) => s.setDeletingEntry)
  const setFileExplorerSelectedPath = useProjectStore((s) => s.setFileExplorerSelectedPath)

  // Load root directory on mount or when project changes
  useEffect(() => {
    const loadRoot = async () => {
      // Skip if already loaded for this project
      if (loadedRef.current === project.path || rootEntries) return

      loadedRef.current = project.path
      setIsLoading(true)
      setError(null)

      try {
        const entries = await api.fs.readDirectory(project.path)
        setDirectoryContents(project.path, entries)
      } catch (err) {
        console.error('Failed to load project directory:', err)
        setError('Failed to load directory')
        loadedRef.current = null // Allow retry
      } finally {
        setIsLoading(false)
      }
    }

    loadRoot()
  }, [api, project.path, rootEntries, setDirectoryContents])

  const handleContextMenu = useCallback((entry: FileSystemEntry, x: number, y: number) => {
    setFileExplorerSelectedPath(entry.path)
    setContextMenu({ entry, x, y })
  }, [setFileExplorerSelectedPath])

  const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ entry: null, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const buildMenuItems = useCallback((entry: FileSystemEntry | null): ContextMenuEntry[] => {
    // Determine where new files/folders should be created
    const createPath = !entry
      ? project.path
      : entry.type === 'directory'
        ? entry.path
        : getParentPath(entry.path)

    const items: ContextMenuEntry[] = [
      { label: 'New File', onClick: () => startCreate(createPath, 'file'), shortcut: 'Ctrl+Alt+N' },
      { label: 'New Folder', onClick: () => startCreate(createPath, 'directory'), shortcut: 'Ctrl+Alt+Shift+N' },
    ]

    if (!entry) return items

    return [
      ...items,
      { type: 'separator' },
      { label: 'Rename', onClick: () => startRename(entry.path), shortcut: 'F2' },
      {
        label: 'Copy Path',
        onClick: () => navigator.clipboard.writeText(entry.path),
        shortcut: 'Ctrl+Shift+C',
      },
      {
        label: 'Reveal in File Explorer',
        onClick: () => api.shell.showItemInFolder(entry.path),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        onClick: () => setDeletingEntry(entry),
        shortcut: 'Del',
        variant: 'destructive',
      },
    ]
  }, [api, project.path, startCreate, startRename, setDeletingEntry])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!rootEntries || rootEntries.length === 0) {
    return (
      <div
        className="px-3 py-4 text-sm text-muted-foreground"
        onContextMenu={handleRootContextMenu}
      >
        {rootEntries ? 'Empty directory' : 'Loading...'}
      </div>
    )
  }

  return (
    <div className="py-1 min-h-full" onContextMenu={handleRootContextMenu}>
      {/* Root-level create ghost entry */}
      {fileExplorerCreating && fileExplorerCreating.parentPath === project.path && (
        <RootCreateEntry type={fileExplorerCreating.type} projectPath={project.path} projectId={project.id} />
      )}

      {rootEntries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          projectId={project.id}
          depth={0}
          isRenaming={fileExplorerRenamingPath === entry.path}
          isCreating={
            fileExplorerCreating && fileExplorerCreating.parentPath === entry.path
              ? { type: fileExplorerCreating.type }
              : null
          }
          onContextMenu={handleContextMenu}
        />
      ))}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu.entry)}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}

/** Inline create entry shown at project root level */
function RootCreateEntry({ type, projectPath, projectId }: { type: 'file' | 'directory'; projectPath: string; projectId: string }) {
  const api = getElectronAPI()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelCreate = useProjectStore((s) => s.cancelCreate)
  const refreshDirectory = useProjectStore((s) => s.refreshDirectory)
  const openEditorTab = useProjectStore((s) => s.openEditorTab)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const handleSubmit = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      cancelCreate()
      return
    }

    const sep = projectPath.includes('\\') ? '\\' : '/'
    const newPath = projectPath + sep + trimmed

    try {
      if (type === 'file') {
        await api.fs.createFile(newPath)
      } else {
        await api.fs.createDirectory(newPath)
      }
      cancelCreate()
      await refreshDirectory(projectPath)
      if (type === 'file') {
        if (isEditableFile(trimmed)) {
          openEditorTab(newPath, trimmed, projectId)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Create failed'
      setError(msg)
    }
  }

  return (
    <div className="flex items-center gap-1.5 py-1 px-2" style={{ paddingLeft: '8px' }}>
      <span className="w-4 flex-shrink-0" />
      {(() => {
        const ic = type === 'directory' ? getFolderIcon(false) : getFileIcon('new')
        const Ic = ic.icon
        return <Ic className="w-4 h-4 flex-shrink-0" style={{ color: ic.color }} />
      })()}
      <div className="flex-1 min-w-0">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') cancelCreate()
          }}
          onBlur={() => {
            if (!value.trim()) cancelCreate()
            else handleSubmit()
          }}
          placeholder={type === 'file' ? 'filename' : 'folder name'}
          className="w-full bg-input border border-border rounded px-1 py-0 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
        {error && <div className="text-xs text-destructive mt-0.5">{error}</div>}
      </div>
    </div>
  )
}
