import { useState, useMemo, useEffect } from 'react'
import { Code, FolderOpen, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { getElectronAPI } from '../../utils/electron'
import type { Project, ProjectType } from '../../types'
import { Dialog } from '../ui/Dialog'
import { btnPrimary, btnSecondary } from '../ui/controls'

const PROJECT_TYPE_OPTIONS = [
  { type: 'project' as const, icon: FolderOpen, label: 'Project', description: 'Files + Claude' },
  { type: 'code' as const, icon: Code, label: 'Code', description: 'Full dev tools' },
]

interface AddProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (project: Project) => void
}

export function AddProjectDialog({ isOpen, onClose, onCreated }: AddProjectDialogProps) {
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

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      title="Add Project"
      icon={FolderOpen}
      size="sm"
      footer={
        <>
          <button onClick={handleClose} disabled={creating} className={btnSecondary}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedPath}
            className={btnPrimary}
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Project
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Project Type Selection */}
        <div>
          <label className="block text-[13px] font-medium text-fg mb-2">Project Type</label>
          <div className="flex gap-2">
            {PROJECT_TYPE_OPTIONS.map(({ type, icon: Icon, label, description }) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={clsx(
                  'flex-1 flex flex-col items-center gap-2 px-3 py-3 rounded-lg border-2 transition-colors',
                  selectedType === type
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:border-border-strong'
                )}
              >
                <Icon
                  className={clsx('w-6 h-6', selectedType === type ? 'text-primary' : 'text-fg-muted')}
                />
                <div className="text-center">
                  <p
                    className={clsx(
                      'text-[12px] font-medium',
                      selectedType === type ? 'text-fg-strong' : 'text-fg-muted'
                    )}
                  >
                    {label}
                  </p>
                  <p className="text-[10px] text-fg-muted mt-0.5">{description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Folder Selection */}
        <div>
          <label className="block text-[13px] font-medium text-fg mb-2">Folder</label>
          <button
            onClick={handleSelectFolder}
            className="w-full px-4 py-3 rounded-md border border-border bg-screen text-left hover:bg-raised transition-colors"
          >
            {selectedPath ? (
              <span className="text-[13px] text-fg truncate block">{selectedPath}</span>
            ) : (
              <span className="text-[13px] text-fg-muted">Click to select folder...</span>
            )}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/20">
            <p className="text-[12.5px] text-danger">{error}</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
