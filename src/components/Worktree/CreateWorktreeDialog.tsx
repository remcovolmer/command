import { useState, useEffect, useMemo } from 'react'
import { X, GitBranch, Plus, Loader2 } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'

interface CreateWorktreeDialogProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  onCreated: (worktree: { id: string; projectId: string; name: string; branch: string; path: string; createdAt: number; isLocked: boolean }) => void
}

export function CreateWorktreeDialog({
  projectId,
  isOpen,
  onClose,
  onCreated,
}: CreateWorktreeDialogProps) {
  const api = useMemo(() => getElectronAPI(), [])

  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedBranch, setSelectedBranch] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [customName, setCustomName] = useState('')
  const [isNewBranch, setIsNewBranch] = useState(false)

  // Load branches when dialog opens
  useEffect(() => {
    if (!isOpen) return

    setLoading(true)
    setError(null)

    api.worktree.listBranches(projectId)
      .then(({ local, remote, current }) => {
        setLocalBranches(local)
        setRemoteBranches(remote)
        setCurrentBranch(current)
        // Pre-select first non-current branch if available
        const available = local.filter(b => b !== current)
        if (available.length > 0) {
          setSelectedBranch(available[0])
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load branches')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [isOpen, projectId, api])

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedBranch('')
      setNewBranchName('')
      setCustomName('')
      setIsNewBranch(false)
      setError(null)
    }
  }, [isOpen])

  const handleCreate = async () => {
    const branchName = isNewBranch ? newBranchName.trim() : selectedBranch
    if (!branchName) {
      setError('Please select or enter a branch name')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const worktree = await api.worktree.create(
        projectId,
        branchName,
        customName.trim() || undefined
      )
      onCreated(worktree)
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create worktree'
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  // Filter out current branch and already used branches
  const availableBranches = useMemo(() => {
    const local = localBranches.filter(b => b !== currentBranch)
    // Add remote branches that aren't in local
    const remoteOnly = remoteBranches.filter(b =>
      !localBranches.includes(b) && b !== currentBranch
    )
    return { local, remote: remoteOnly }
  }, [localBranches, remoteBranches, currentBranch])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-background rounded-lg shadow-xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">New Worktree</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Branch Selection Mode */}
              <div className="flex gap-2">
                <button
                  onClick={() => setIsNewBranch(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    !isNewBranch
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Existing Branch
                </button>
                <button
                  onClick={() => setIsNewBranch(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isNewBranch
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Plus className="w-4 h-4 inline mr-1" />
                  New Branch
                </button>
              </div>

              {/* Existing Branch Selection */}
              {!isNewBranch && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Select Branch
                  </label>
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select a branch...</option>
                    {availableBranches.local.length > 0 && (
                      <optgroup label="Local Branches">
                        {availableBranches.local.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {availableBranches.remote.length > 0 && (
                      <optgroup label="Remote Branches">
                        {availableBranches.remote.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {availableBranches.local.length === 0 && availableBranches.remote.length === 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No available branches. Create a new branch instead.
                    </p>
                  )}
                </div>
              )}

              {/* New Branch Input */}
              {isNewBranch && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="feature/my-feature"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
              )}

              {/* Custom Name (Optional) */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Worktree Name{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={isNewBranch ? newBranchName.replace(/\//g, '-') : selectedBranch.replace(/\//g, '-')}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Defaults to branch name with / replaced by -
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || creating || (!isNewBranch && !selectedBranch) || (isNewBranch && !newBranchName.trim())}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Worktree
          </button>
        </div>
      </div>
    </div>
  )
}
