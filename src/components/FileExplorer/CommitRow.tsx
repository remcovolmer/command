import { useMemo } from 'react'
import { GitMerge, Copy, Tag } from 'lucide-react'
import type { GitCommit, GitCommitDetail } from '../../types'
import { CommitDetail } from './CommitDetail'

interface CommitRowProps {
  commit: GitCommit
  isFirst: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onCopyHash: () => void
  gitPath: string
  detailCache: React.MutableRefObject<Record<string, GitCommitDetail>>
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffWeek < 5) return `${diffWeek}w ago`
  if (diffMonth < 12) return `${diffMonth}mo ago`
  return `${diffYear}y ago`
}

export function CommitRow({
  commit,
  isFirst,
  isExpanded,
  onToggleExpand,
  onCopyHash,
  gitPath,
  detailCache,
}: CommitRowProps) {
  const isMerge = commit.parentHashes.length > 1
  const relativeTime = useMemo(() => formatRelativeTime(commit.authorDate), [commit.authorDate])

  return (
    <div className="border-t border-border/30 first:border-t-0">
      {/* Compact row */}
      <button
        onClick={onToggleExpand}
        className={`
          w-full flex items-center gap-1.5 px-3 py-1.5 text-left
          hover:bg-sidebar-accent transition-colors text-sm
          ${isExpanded ? 'bg-sidebar-accent' : ''}
        `}
      >
        {/* Indicators */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isFirst && (
            <span title="HEAD"><Tag className="w-3 h-3 text-primary" /></span>
          )}
          {isMerge && (
            <span title="Merge commit"><GitMerge className="w-3 h-3 text-purple-500" /></span>
          )}
        </div>

        {/* Commit message */}
        <span className="truncate flex-1 text-sidebar-foreground">
          {commit.message}
        </span>

        {/* Short hash (clickable to copy) */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onCopyHash()
          }}
          className="flex-shrink-0 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
          title={`Copy ${commit.hash}`}
        >
          {commit.shortHash}
        </button>

        {/* Relative time */}
        <span className="flex-shrink-0 text-xs text-muted-foreground w-[4.5rem] text-right">
          {relativeTime}
        </span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <CommitDetail
          commit={commit}
          gitPath={gitPath}
          detailCache={detailCache}
        />
      )}
    </div>
  )
}
