import { useState, useRef, useEffect } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getFileIcon, getFolderIcon } from './fileIcons'
import { isEditableFile } from '../../utils/editorLanguages'

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

  // Use specific selectors to avoid creating new references
  const isExpanded = useProjectStore(
    (s) => s.expandedPaths[projectId]?.includes(entry.path) ?? false
  )
  const children = useProjectStore(
    (s) => s.directoryCache[entry.path]
  )
  const toggleExpandedPath = useProjectStore((s) => s.toggleExpandedPath)
  const setDirectoryContents = useProjectStore((s) => s.setDirectoryContents)
  const directoryCache = useProjectStore((s) => s.directoryCache)
  const openEditorTab = useProjectStore((s) => s.openEditorTab)
  const cancelRename = useProjectStore((s) => s.cancelRename)
  const cancelCreate = useProjectStore((s) => s.cancelCreate)
  const refreshDirectory = useProjectStore((s) => s.refreshDirectory)
  const fileExplorerRenamingPath = useProjectStore((s) => s.fileExplorerRenamingPath)
  const fileExplorerCreating = useProjectStore((s) => s.fileExplorerCreating)

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
    if (!directoryCache[entry.path]) {
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

    if (!isDirectory) {
      if (isEditableFile(entry.name, entry.extension)) {
        openEditorTab(entry.path, entry.name, projectId)
      }
      return
    }

    // If expanding and not cached, load contents
    if (!isExpanded && !directoryCache[entry.path]) {
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

    toggleExpandedPath(projectId, entry.path)
  }

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(entry, e.clientX, e.clientY)
  }

  const getParentPath = (filePath: string) => {
    const sep = filePath.includes('\\') ? '\\' : '/'
    const parts = filePath.split(sep)
    parts.pop()
    return parts.join(sep)
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
        const state = useProjectStore.getState()
        const currentPaths = state.expandedPaths[projectId] ?? []
        const updatedPaths = currentPaths.map((p) =>
          p === entry.path ? newPath : p.startsWith(entry.path + sep) ? newPath + p.slice(entry.path.length) : p
        )
        if (JSON.stringify(updatedPaths) !== JSON.stringify(currentPaths)) {
          useProjectStore.setState((s) => ({
            expandedPaths: { ...s.expandedPaths, [projectId]: updatedPaths },
          }))
        }
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

    const sep = entry.path.includes('\\') ? '\\' : '/'
    const newPath = entry.path + sep + trimmed

    try {
      if (isCreating!.type === 'file') {
        await api.fs.createFile(newPath)
      } else {
        await api.fs.createDirectory(newPath)
      }
      cancelCreate()
      await refreshDirectory(entry.path)

      // Open the file in editor if it's a file
      if (isCreating!.type === 'file' && isEditableFile(trimmed)) {
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

  // Check if children have entries being renamed or created
  const childRenamingPath = fileExplorerRenamingPath
  const childCreating = fileExplorerCreating

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
              <span className="w-4 h-4 flex-shrink-0 text-muted-foreground">
                {isCreating.type === 'directory' ? '📁' : '📄'}
              </span>
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
              isRenaming={childRenamingPath === child.path}
              isCreating={
                childCreating && childCreating.parentPath === child.path
                  ? { type: childCreating.type }
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
