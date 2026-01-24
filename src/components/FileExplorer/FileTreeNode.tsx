import { useState, useMemo } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { FileSystemEntry } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { getFileIcon, getFolderIcon } from './fileIcons'

interface FileTreeNodeProps {
  entry: FileSystemEntry
  projectId: string
  depth: number
}

export function FileTreeNode({ entry, projectId, depth }: FileTreeNodeProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const [isLoading, setIsLoading] = useState(false)

  const expandedPaths = useProjectStore((s) => s.expandedPaths[projectId] ?? [])
  const directoryCache = useProjectStore((s) => s.directoryCache)
  const toggleExpandedPath = useProjectStore((s) => s.toggleExpandedPath)
  const setDirectoryContents = useProjectStore((s) => s.setDirectoryContents)

  const isDirectory = entry.type === 'directory'
  const isExpanded = expandedPaths.includes(entry.path)
  const children = directoryCache[entry.path] ?? []

  const handleClick = async () => {
    if (!isDirectory) return

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

  const iconConfig = isDirectory
    ? getFolderIcon(isExpanded)
    : getFileIcon(entry.name, entry.extension)

  const Icon = iconConfig.icon

  return (
    <div>
      <button
        onClick={handleClick}
        className={`
          w-full flex items-center gap-1.5 py-1 px-2 rounded text-left
          text-sm text-claude-sidebar-text
          hover:bg-claude-sidebar-hover transition-colors
          ${isDirectory ? 'cursor-pointer' : 'cursor-default'}
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Chevron for directories */}
        {isDirectory && (
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-claude-sidebar-muted" />
            ) : (
              <ChevronRight
                className={`w-3 h-3 text-claude-sidebar-muted transition-transform duration-150 ${
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

        {/* Name */}
        <span className="truncate">{entry.name}</span>
      </button>

      {/* Children (expanded directories) */}
      {isDirectory && isExpanded && children.length > 0 && (
        <div className="overflow-hidden">
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              projectId={projectId}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
