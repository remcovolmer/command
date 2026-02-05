import { useState, useMemo, useEffect } from 'react'
import { X, Code, FolderOpen, Loader2, Star } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import type { Project, ProjectType } from '../../types'

const PROJECT_TYPE_OPTIONS = [
  { type: 'workspace' as const, icon: Star, label: 'Workspace', description: 'Pinned overview' },
  { type: 'project' as const, icon: FolderOpen, label: 'Project', description: 'Files + Claude' },
  { type: 'code' as const, icon: Code, label: 'Code', description: 'Full dev tools' },
]

interface AddProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (project: Project) => void
}

export function AddProjectDialog({
  isOpen,
  onClose,
  onCreated,
}: AddProjectDialogProps) {
  const api = useMemo(() => getElectronAPI(), [])

  const [selectedType, setSelectedType] = useState<ProjectType>('project')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedType('project')
      setSelectedPath(null)
      setError(null)
    }
  }, [isOpen])

  const handleSelectFolder = async () => {
    const folderPath = await api.project.selectFolder()
    if (folderPath) {
      setSelectedPath(folderPath)
      setError(null)
    }
  }

  const handleCreate = async () => {
    if (!selectedPath) {
      setError('Please select a folder')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const project = await api.project.add(selectedPath, undefined, selectedType)
      onCreated(project)
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add project'
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  // Reset form when dialog closes
  const handleClose = () => {
    setSelectedType('project')
    setSelectedPath(null)
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-background rounded-lg shadow-xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Add Project</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Project Type Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Project Type
            </label>
            <div className="flex gap-2">
              {PROJECT_TYPE_OPTIONS.map(({ type, icon: Icon, label, description }) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`flex-1 flex flex-col items-center gap-2 px-3 py-3 rounded-lg border-2 transition-colors ${
                    selectedType === type
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground'
                  }`}
                >
                  <Icon className={`w-6 h-6 ${selectedType === type ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="text-center">
                    <p className={`text-xs font-medium ${selectedType === type ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {label}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Folder Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Folder
            </label>
            <button
              onClick={handleSelectFolder}
              className="w-full px-4 py-3 rounded-lg border border-border bg-background text-left hover:bg-muted/50 transition-colors"
            >
              {selectedPath ? (
                <span className="text-sm text-foreground truncate block">{selectedPath}</span>
              ) : (
                <span className="text-sm text-muted-foreground">Click to select folder...</span>
              )}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            disabled={creating}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedPath}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Project
          </button>
        </div>
      </div>
    </div>
  )
}
