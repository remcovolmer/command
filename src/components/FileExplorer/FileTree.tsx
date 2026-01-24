import { useEffect, useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import type { Project } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { FileTreeNode } from './FileTreeNode'

interface FileTreeProps {
  project: Project
}

export function FileTree({ project }: FileTreeProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const directoryCache = useProjectStore((s) => s.directoryCache)
  const setDirectoryContents = useProjectStore((s) => s.setDirectoryContents)

  const rootEntries = directoryCache[project.path] ?? []

  // Load root directory on mount
  useEffect(() => {
    const loadRoot = async () => {
      if (directoryCache[project.path]) return // Already cached

      setIsLoading(true)
      setError(null)

      try {
        const entries = await api.fs.readDirectory(project.path)
        setDirectoryContents(project.path, entries)
      } catch (err) {
        console.error('Failed to load project directory:', err)
        setError('Failed to load directory')
      } finally {
        setIsLoading(false)
      }
    }

    loadRoot()
  }, [api, project.path, directoryCache, setDirectoryContents])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-claude-sidebar-muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-sm text-claude-error">
        {error}
      </div>
    )
  }

  if (rootEntries.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-claude-sidebar-muted">
        Empty directory
      </div>
    )
  }

  return (
    <div className="py-1">
      {rootEntries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          projectId={project.id}
          depth={0}
        />
      ))}
    </div>
  )
}
