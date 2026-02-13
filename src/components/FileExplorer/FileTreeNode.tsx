import { useState, useRef, useEffect } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getFileIcon, getFolderIcon } from './fileIcons'
import { isEditableFile } from '../../utils/editorLanguages'
import { getParentPath } from '../../utils/paths'

interface FileTreeNodeProps {
  entry: FileSystemEntry
  projectId: string
  depth: number
  isRenaming: boolean
  isCreating: { type: 'file' | 'directory' } | null
  onContextMenu: (entry: FileSystemEntry, x: number, y: number) => void
}

export function FileTreeNode({ entry, projectId, depth, isRenaming, isCreating, onContextMenu }: FileTreeNodeProps) {
  const api = getElectronAPI()
  const [isLoading, setIsLoading] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [createValue, setCreateValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  // Use specific selectors to avoid unnecessary re-renders
  const isExpanded = useProjectStore(
    (s) => s.expandedPaths[projectId]?.includes(entry.path) ?? false
  )
  const children = useProjectStore(
    (s) => s.directoryCache[entry.path]
  )
  const toggleExpandedPath = useProjectStore((s) => s.toggleExpandedPath)
  const setDirectoryContents = useProjectStore((s) => s.setDirectoryContents)
  const openEditorTab = useProjectStore((s) => s.openEditorTab)
  const cancelRename = useProjectStore((s) => s.cancelRename)
  const cancelCreate = useProjectStore((s) => s.cancelCreate)
  const refreshDirectory = useProjectStore((s) => s.refreshDirectory)
  const setFileExplorerSelectedPath = useProjectStore((s) => s.setFileExplorerSelectedPath)
  const updateExpandedPathsAfterRename = useProjectStore((s) => s.updateExpandedPathsAfterRename)

  const isDirectory = entry.type === 'directory'

  // Initialize rename input when entering rename mode
  useEffect(() => {
    if (isRenaming) {
      setRenameValue(entry.name)
      setRenameError(null)
      requestAnimationFrame(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus()
          // Select filename without extension for files
          if (!isDirectory) {
            const dotIndex = entry.name.lastIndexOf('.')
            if (dotIndex > 0) {
              renameInputRef.current.setSelectionRange(0, dotIndex)
            } else {
              renameInputRef.current.select()
            }
          } else {
            renameInputRef.current.select()
          }
        }
      })
    }
  }, [isRenaming, entry.name, isDirectory])

  // Initialize create input when entering create mode
  useEffect(() => {
    if (isCreating) {
      setCreateValue('')
      setCreateError(null)
      // Ensure folder is expanded
      if (!isExpanded) {
        handleExpand()
      }
      requestAnimationFrame(() => {
        createInputRef.current?.focus()
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreating])

  const handleExpand = async () => {
    if (!children) {
      setIsLoading(true)
      try {
        const contents = await api.fs.readDirectory(entry.path)
        setDirectoryContents(entry.path, contents)
      } catch (error) {
        console.error('Failed to load directory:', error)
      } finally {
        setIsLoading(false)
      }
    }
    if (!isExpanded) {
      toggleExpandedPath(projectId, entry.path)
    }
  }

  const handleClick = async () => {
    if (isRenaming) return

    // Track selected path for keyboard shortcuts
    setFileExplorerSelectedPath(entry.path)

    if (!isDirectory) {
      if (isEditableFile(entry.name, entry.extension)) {
        openEditorTab(entry.path, entry.name, projectId)
      }
      return
    }

    if (isExpanded) {
      toggleExpandedPath(projectId, entry.path)
    } else {
      await handleExpand()
    }
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(entry, e.clientX, e.clientY)
  }

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === entry.name) {
      cancelRename()
      return
    }

    const parentPath = getParentPath(entry.path)
    const sep = entry.path.includes('\\') ? '\\' : '/'
    const newPath = parentPath + sep + trimmed

    try {
      await api.fs.rename(entry.path, newPath)
      cancelRename()
      await refreshDirectory(parentPath)

      // Update expandedPaths if renamed directory was expanded
      if (isDirectory) {
        updateExpandedPathsAfterRename(projectId, entry.path, newPath)
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Rename failed'
      setRenameError(msg)
    }
  }

  const handleCreateSubmit = async () => {
    const trimmed = createValue.trim()
    if (!trimmed) {
      cancelCreate()
      return
    }

    if (!isCreating) return

    const sep = entry.path.includes('\\') ? '\\' : '/'
    const newPath = entry.path + sep + trimmed

    try {
      if (isCreating.type === 'file') {
        await api.fs.createFile(newPath)
      } else {
        await api.fs.createDirectory(newPath)
      }
      cancelCreate()
      await refreshDirectory(entry.path)

      // Open the file in editor if it's a file
      if (isCreating.type === 'file' && isEditableFile(trimmed)) {
        openEditorTab(newPath, trimmed, projectId)
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Create failed'
      setCreateError(msg)
    }
  }

  const iconConfig = isDirectory
    ? getFolderIcon(isExpanded)
    : getFileIcon(entry.name, entry.extension)

  const Icon = iconConfig.icon

  // Read renaming/creating state for children via props from parent
  const fileExplorerRenamingPath = useProjectStore((s) => s.fileExplorerRenamingPath)
  const fileExplorerCreating = useProjectStore((s) => s.fileExplorerCreating)

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={handleRightClick}
        className={`
          w-full flex items-center gap-1.5 py-1 px-2 rounded text-left
          text-sm text-sidebar-foreground
          hover:bg-sidebar-accent transition-colors
          cursor-pointer
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Chevron for directories */}
        {isDirectory && (
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight
                className={`w-3 h-3 text-muted-foreground transition-transform duration-150 ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
            )}
          </span>
        )}

        {/* Spacer for files to align with folder names */}
        {!isDirectory && <span className="w-4 flex-shrink-0" />}

        {/* File/folder icon */}
        <Icon
          className="w-4 h-4 flex-shrink-0"
          style={{ color: iconConfig.color }}
        />

        {/* Name or rename input */}
        {isRenaming ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => { setRenameValue(e.target.value); setRenameError(null) }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') cancelRename()
              }}
              onBlur={handleRenameSubmit}
              className="w-full bg-input border border-border rounded px-1 py-0 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            {renameError && (
              <div className="text-xs text-destructive mt-0.5">{renameError}</div>
            )}
          </div>
        ) : (
          <span className="truncate">{entry.name}</span>
        )}
      </button>

      {/* Children (expanded directories) */}
      {isDirectory && isExpanded && (
        <div className="overflow-hidden">
          {/* Ghost create entry at top of children */}
          {isCreating && (
            <div
              className="flex items-center gap-1.5 py-1 px-2"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <span className="w-4 flex-shrink-0" />
              {(() => {
                const ic = isCreating.type === 'directory' ? getFolderIcon(false) : getFileIcon('new')
                const Ic = ic.icon
                return <Ic className="w-4 h-4 flex-shrink-0" style={{ color: ic.color }} />
              })()}
              <div className="flex-1 min-w-0">
                <input
                  ref={createInputRef}
                  value={createValue}
                  onChange={(e) => { setCreateValue(e.target.value); setCreateError(null) }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') handleCreateSubmit()
                    if (e.key === 'Escape') cancelCreate()
                  }}
                  onBlur={() => {
                    if (!createValue.trim()) cancelCreate()
                    else handleCreateSubmit()
                  }}
                  placeholder={isCreating.type === 'file' ? 'filename' : 'folder name'}
                  className="w-full bg-input border border-border rounded px-1 py-0 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                {createError && (
                  <div className="text-xs text-destructive mt-0.5">{createError}</div>
                )}
              </div>
            </div>
          )}

          {children && children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              projectId={projectId}
              depth={depth + 1}
              isRenaming={fileExplorerRenamingPath === child.path}
              isCreating={
                fileExplorerCreating && fileExplorerCreating.parentPath === child.path
                  ? { type: fileExplorerCreating.type }
                  : null
              }
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}
