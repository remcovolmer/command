import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Loader2, Search } from 'lucide-react'
import { getElectronAPI } from '../../utils/electron'
import type { GitBranchListItem } from '../../types'

interface BranchDropdownProps {
  gitPath: string
  currentBranch: string
  triggerRef: RefObject<HTMLElement | null>
  onClose: () => void
  onSwitch: (name: string) => void
}

const MAX_RENDERED = 50

export function BranchDropdown({ gitPath, currentBranch, triggerRef, onClose, onSwitch }: BranchDropdownProps) {
  const api = getElectronAPI()
  const [branches, setBranches] = useState<GitBranchListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })

  // Fetch branches on open
  useEffect(() => {
    let cancelled = false
    const fetchBranches = async () => {
      try {
        const list = await api.git.listBranches(gitPath)
        if (!cancelled) {
          setBranches(list)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    fetchBranches()
    return () => { cancelled = true }
  }, [api, gitPath])

  // Position dropdown below trigger
  useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 220),
    })
  }, [triggerRef])

  // Auto-focus search
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  // Click outside to close
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const filtered = branches.filter(
    (b) => !b.current && b.name.toLowerCase().includes(filter.toLowerCase())
  )
  const displayed = filtered.slice(0, MAX_RENDERED)
  const totalFiltered = filtered.length

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, displayed.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && displayed[activeIndex]) {
      e.preventDefault()
      onSwitch(displayed[activeIndex].name)
    }
  }, [displayed, activeIndex, onSwitch])

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const valid = await api.git.validateBranchName(gitPath, newBranchName.trim())
      if (!valid) {
        setError('Invalid branch name')
        setCreating(false)
        return
      }
      await api.git.createBranch(gitPath, newBranchName.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch')
    } finally {
      setCreating(false)
    }
  }, [api, gitPath, newBranchName, creating, onClose])

  const handleDeleteBranch = useCallback(async (name: string, force = false) => {
    setDeleting(name)
    setError(null)
    try {
      await api.git.deleteBranch(gitPath, name, force)
      setBranches((prev) => prev.filter((b) => b.name !== name))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      if (!force && msg.includes('not fully merged')) {
        if (confirm(`Branch "${name}" is not fully merged. Force delete?`)) {
          await handleDeleteBranch(name, true)
          return
        }
      } else {
        setError(msg)
      }
    } finally {
      setDeleting(null)
    }
  }, [api, gitPath])

  // Adjust position if near bottom of viewport
  const adjustedTop = Math.min(position.top, window.innerHeight - 300)

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
      style={{
        top: adjustedTop,
        left: position.left,
        width: position.width,
        maxHeight: 280,
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Search */}
      <div className="p-2 border-b border-border/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            ref={searchRef}
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setActiveIndex(0) }}
            placeholder="Filter branches..."
            className="w-full bg-input border border-border rounded-md pl-7 pr-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* New branch */}
      <div className="border-b border-border/50">
        {showNewBranch ? (
          <div className="p-2">
            <div className="flex items-center gap-1.5">
              <input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleCreateBranch() }
                  if (e.key === 'Escape') { e.stopPropagation(); setShowNewBranch(false); setNewBranchName('') }
                }}
                placeholder="Branch name"
                autoFocus
                className="flex-1 bg-input border border-border rounded-md px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim() || creating}
                className="px-2 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
              </button>
            </div>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        ) : (
          <button
            onClick={() => setShowNewBranch(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New branch
          </button>
        )}
      </div>

      {/* Branch list */}
      <div className="overflow-y-auto max-h-[180px] sidebar-scroll">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            {filter ? 'No matching branches' : 'No other branches'}
          </div>
        ) : (
          <>
            {/* Current branch (always shown at top if not filtered out) */}
            {!filter && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-sidebar-accent/50">
                <span className="text-primary font-medium truncate flex-1">{currentBranch}</span>
                <span className="text-xs text-muted-foreground">current</span>
              </div>
            )}

            {displayed.map((branch, i) => (
              <div
                key={branch.name}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors group ${
                  i === activeIndex ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'
                }`}
                onClick={() => onSwitch(branch.name)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="text-sidebar-foreground truncate flex-1">{branch.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteBranch(branch.name)
                  }}
                  disabled={deleting === branch.name}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted/80 transition-all"
                  title="Delete branch"
                >
                  {deleting === branch.name ? (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  ) : (
                    <Trash2 className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            ))}

            {totalFiltered > MAX_RENDERED && (
              <div className="px-3 py-1.5 text-xs text-muted-foreground text-center">
                Showing {MAX_RENDERED} of {totalFiltered} — type to filter
              </div>
            )}
          </>
        )}
      </div>

      {/* Error display */}
      {error && !showNewBranch && (
        <div className="px-3 py-1.5 text-xs text-red-500 border-t border-border/50">{error}</div>
      )}
    </div>,
    document.body
  )
}
