import { useState, useEffect, useMemo, useCallback } from 'react'
import { GitBranch, Plus, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { getElectronAPI } from '../../utils/electron'
import { useDialogHotkeys } from '../../hooks/useHotkeys'
import { useProjectStore } from '../../stores/projectStore'
import { AGENT_DISPLAY, AGENT_IDS } from '@shared/agents'
import type { AgentType } from '../../types'
import { Dialog } from '../ui/Dialog'
import { btnPrimary, btnSecondary, btnGhost, input, select } from '../ui/controls'

interface CreateWorktreeDialogProps {
  projectId: string
  isOpen: boolean
  onClose: () => void
  onCreated: (
    worktree: {
      id: string
      projectId: string
      name: string
      branch: string
      path: string
      createdAt: number
      isLocked: boolean
    },
    agent: AgentType
  ) => void
}

export function CreateWorktreeDialog({
  projectId,
  isOpen,
  onClose,
  onCreated,
}: CreateWorktreeDialogProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const projectDefaultAgent =
    useProjectStore((s) => s.projects.find((p) => p.id === projectId)?.settings?.defaultAgent) ??
    'claude'

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
  const [sourceBranch, setSourceBranch] = useState('main')
  const [agent, setAgent] = useState<AgentType>('claude')

  // Determine if form is valid for submission
  const canSubmit =
    !loading &&
    !creating &&
    ((isNewBranch && newBranchName.trim()) || (!isNewBranch && selectedBranch))

  // Load branches when dialog opens
  useEffect(() => {
    if (!isOpen) return

    setLoading(true)
    setError(null)
    setAgent(projectDefaultAgent)

    api.worktree
      .listBranches(projectId)
      .then(({ local, remote, current }) => {
        setLocalBranches(local)
        setRemoteBranches(remote)
        setCurrentBranch(current)
        // Pre-select first non-current branch if available
        const available = local.filter((b) => b !== current)
        if (available.length > 0) {
          setSelectedBranch(available[0])
        }
        // Default source branch: prefer main (local first, then remote), else current
        const remoteOnly = remote.filter((b) => !local.includes(b))
        if (local.includes('main')) {
          setSourceBranch('main')
        } else if (remoteOnly.includes('main')) {
          setSourceBranch('origin/main')
        } else if (current && local.includes(current)) {
          setSourceBranch(current)
        } else if (local.length > 0) {
          setSourceBranch(local[0])
        } else if (remoteOnly.length > 0) {
          setSourceBranch(`origin/${remoteOnly[0]}`)
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load branches')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [isOpen, projectId, api, projectDefaultAgent])

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedBranch('')
      setNewBranchName('')
      setCustomName('')
      setIsNewBranch(false)
      setSourceBranch('main')
      setError(null)
    }
  }, [isOpen])

  const handleCreate = useCallback(async () => {
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
        customName.trim() || undefined,
        isNewBranch ? sourceBranch || undefined : undefined
      )
      onCreated(worktree, agent)
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create worktree'
      setError(message)
    } finally {
      setCreating(false)
    }
  }, [
    api,
    projectId,
    isNewBranch,
    newBranchName,
    selectedBranch,
    customName,
    sourceBranch,
    agent,
    onCreated,
    onClose,
  ])

  // Keyboard shortcuts: Escape to close, Enter to confirm
  useDialogHotkeys(onClose, canSubmit ? handleCreate : undefined, {
    enabled: isOpen,
    canConfirm: !!canSubmit,
  })

  // Remote branches not already in local
  const remoteOnlyBranches = useMemo(
    () => remoteBranches.filter((b) => !localBranches.includes(b)),
    [localBranches, remoteBranches]
  )

  // Filter out current branch and already used branches
  const availableBranches = useMemo(() => {
    const local = localBranches.filter((b) => b !== currentBranch)
    const remote = remoteOnlyBranches.filter((b) => b !== currentBranch)
    return { local, remote }
  }, [localBranches, remoteOnlyBranches, currentBranch])

  const isCreateDisabled =
    loading || creating || (!isNewBranch && !selectedBranch) || (isNewBranch && !newBranchName.trim())

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="New Worktree"
      icon={GitBranch}
      size="sm"
      footer={
        <>
          <button onClick={onClose} disabled={creating} className={btnSecondary}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={isCreateDisabled} className={btnPrimary}>
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Worktree
          </button>
        </>
      }
    >
      <div className="space-y-4">
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
                className={clsx(
                  'flex-1',
                  !isNewBranch ? btnPrimary : btnGhost,
                  'justify-center'
                )}
              >
                Existing Branch
              </button>
              <button
                onClick={() => setIsNewBranch(true)}
                className={clsx('flex-1', isNewBranch ? btnPrimary : btnGhost, 'justify-center')}
              >
                <Plus className="w-4 h-4" />
                New Branch
              </button>
            </div>

            {/* Existing Branch Selection */}
            {!isNewBranch && (
              <div>
                <label className="block text-[13px] font-medium text-fg mb-2">
                  Select Branch
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className={clsx(select, 'w-full')}
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
                  <p className="mt-2 text-[12.5px] text-fg-muted">
                    No available branches. Create a new branch instead.
                  </p>
                )}
              </div>
            )}

            {/* New Branch Input */}
            {isNewBranch && (
              <>
                <div>
                  <label className="block text-[13px] font-medium text-fg mb-2">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="feature/my-feature"
                    className={clsx(input, 'w-full')}
                    autoFocus
                  />
                </div>

                {/* Source Branch Selection */}
                <div>
                  <label className="block text-[13px] font-medium text-fg mb-2">Based on</label>
                  <select
                    value={sourceBranch}
                    onChange={(e) => setSourceBranch(e.target.value)}
                    className={clsx(select, 'w-full')}
                  >
                    {localBranches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                    {remoteOnlyBranches.length > 0 && (
                      <optgroup label="Remote">
                        {remoteOnlyBranches.map((branch) => (
                          <option key={branch} value={`origin/${branch}`}>
                            origin/{branch}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </>
            )}

            {/* Agent for the worktree's chat */}
            <div>
              <label className="block text-[13px] font-medium text-fg mb-2">Agent</label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value as AgentType)}
                className={clsx(select, 'w-full')}
              >
                {AGENT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {AGENT_DISPLAY[id].label}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom Name (Optional) */}
            <div>
              <label className="block text-[13px] font-medium text-fg mb-2">
                Worktree Name <span className="text-fg-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={
                  isNewBranch
                    ? newBranchName.replace(/\//g, '-')
                    : selectedBranch.replace(/\//g, '-')
                }
                className={clsx(input, 'w-full')}
              />
              <p className="mt-1.5 text-[12px] text-fg-muted">
                Defaults to branch name with / replaced by -
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="px-3 py-2 rounded-md bg-danger/10 border border-danger/20">
                <p className="text-[12.5px] text-danger">{error}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
