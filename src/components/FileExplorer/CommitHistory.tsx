import { useEffect, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, History } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { CommitRow } from './CommitRow'
import type { GitCommitDetail } from '../../types'

interface CommitHistoryProps {
  gitPath: string
  contextId: string
}

export function CommitHistory({ gitPath, contextId }: CommitHistoryProps) {
  const api = useMemo(() => getElectronAPI(), [])
  const commitLog = useProjectStore((s) => s.gitCommitLog[contextId])
  const isLoading = useProjectStore((s) => s.gitCommitLogLoading[contextId] ?? false)
  const expandedHash = useProjectStore((s) => s.expandedCommitHash[contextId] ?? null)
  const setGitCommitLog = useProjectStore((s) => s.setGitCommitLog)
  const appendGitCommitLog = useProjectStore((s) => s.appendGitCommitLog)
  const setGitCommitLogLoading = useProjectStore((s) => s.setGitCommitLogLoading)
  const setExpandedCommit = useProjectStore((s) => s.setExpandedCommit)

  const parentRef = useRef<HTMLDivElement>(null)
  const commits = commitLog?.commits ?? []
  const hasMore = commitLog?.hasMore ?? false

  // Commit detail cache (loaded on expand)
  const detailCacheRef = useRef<Record<string, GitCommitDetail>>({})

  // Load initial commit log
  const loadInitial = useCallback(async () => {
    setGitCommitLogLoading(contextId, true)
    try {
      const log = await api.git.getCommitLog(gitPath)
      setGitCommitLog(contextId, log)
    } catch (error) {
      console.error('Failed to load commit log:', error)
    } finally {
      setGitCommitLogLoading(contextId, false)
    }
  }, [api, gitPath, contextId, setGitCommitLog, setGitCommitLogLoading])

  // Load more commits
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return
    setGitCommitLogLoading(contextId, true)
    try {
      const cursor = commitLog?.cursor ?? 0
      const log = await api.git.getCommitLog(gitPath, cursor)
      appendGitCommitLog(contextId, log)
    } catch (error) {
      console.error('Failed to load more commits:', error)
    } finally {
      setGitCommitLogLoading(contextId, false)
    }
  }, [api, gitPath, contextId, isLoading, hasMore, commitLog?.cursor, appendGitCommitLog, setGitCommitLogLoading])

  // Initial load
  useEffect(() => {
    if (!commitLog) {
      loadInitial()
    }
  }, [contextId, commitLog, loadInitial])

  // Estimate row heights: normal = 36px, expanded = ~200px
  const virtualizer = useVirtualizer({
    count: commits.length + (hasMore ? 1 : 0), // +1 for "load more" sentinel
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      if (index >= commits.length) return 36 // load more button
      return commits[index]?.hash === expandedHash ? 250 : 36
    },
    overscan: 10,
  })

  // Detect scroll near bottom to load more
  useEffect(() => {
    const items = virtualizer.getVirtualItems()
    if (items.length === 0) return
    const lastItem = items[items.length - 1]
    if (lastItem && lastItem.index >= commits.length - 5 && hasMore && !isLoading) {
      loadMore()
    }
  }, [virtualizer.getVirtualItems(), commits.length, hasMore, isLoading, loadMore])

  const handleToggleExpand = useCallback((hash: string) => {
    setExpandedCommit(contextId, expandedHash === hash ? null : hash)
  }, [contextId, expandedHash, setExpandedCommit])

  const handleCopyHash = useCallback((fullHash: string) => {
    navigator.clipboard.writeText(fullHash)
  }, [])

  // Loading state for initial load
  if (!commitLog && isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Empty state
  if (commits.length === 0 && !isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <History className="w-4 h-4" />
        <span>No commits yet</span>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto sidebar-scroll">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const index = virtualRow.index

          // Load more sentinel
          if (index >= commits.length) {
            return (
              <div
                key="load-more"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex items-center justify-center"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <button
                    onClick={loadMore}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Load more...
                  </button>
                )}
              </div>
            )
          }

          const commit = commits[index]
          const isExpanded = commit.hash === expandedHash

          return (
            <div
              key={commit.hash}
              ref={virtualizer.measureElement}
              data-index={index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <CommitRow
                commit={commit}
                isFirst={index === 0}
                isExpanded={isExpanded}
                onToggleExpand={() => handleToggleExpand(commit.hash)}
                onCopyHash={() => handleCopyHash(commit.hash)}
                gitPath={gitPath}
                detailCache={detailCacheRef}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
