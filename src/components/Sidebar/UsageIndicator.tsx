import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import {
  formatResetTime,
  formatCredits,
  usageLevel,
  type UsageLevel,
} from '../../utils/usageFormat'

const LEVEL_BAR: Record<UsageLevel, string> = {
  normal: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-popover-foreground tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Plan-usage bar in the sidebar footer: 5-hour-window utilization with reset
 * time, colored by whichever limit (5h or weekly) is closest to binding so a
 * calm 5h bar can't mask a nearly-exhausted week. Details on hover.
 */
export function UsageIndicator() {
  const usageData = useProjectStore((s) => s.usageData)
  const showUsageIndicator = useProjectStore((s) => s.showUsageIndicator)
  const [hovered, setHovered] = useState(false)

  // Reset hover when the indicator hides: the div unmounts before
  // onMouseLeave can fire, so without this the popover would reappear
  // open when the indicator returns. Render-time state adjustment per the
  // React "storing information from previous renders" pattern.
  const hasData = Boolean(usageData && usageData.status === 'ok')

  // Reset hover when the bar (the only part with a popover) isn't shown: the div
  // unmounts before onMouseLeave can fire, so without this the popover would
  // reappear open when data returns. Render-time state adjustment per the React
  // "storing information from previous renders" pattern.
  if (!hasData && hovered) {
    setHovered(false)
  }

  // Toggled off is an intentional hide — render nothing.
  if (!showUsageIndicator) return null

  // Enabled but no usable data yet: show a muted placeholder instead of nothing,
  // so the indicator stays present in the footer and "off" remains
  // distinguishable from "no data". Swaps to the live bar once data arrives.
  if (!usageData || usageData.status !== 'ok') {
    return (
      <div
        className="mb-1.5 flex items-center gap-2"
        title="Usage data unavailable — retrying"
      >
        <div className="flex-1 h-1 rounded-full bg-muted" />
        <span className="text-[10px] text-muted-foreground/50 shrink-0">usage n/a</span>
      </div>
    )
  }

  const fiveHour = usageData.fiveHour
  const week = usageData.sevenDay
  const fivePct = fiveHour?.utilization ?? 0
  const weekPct = week?.utilization ?? 0
  const barWidth = Math.min(100, Math.max(0, fivePct))
  const level = usageLevel(Math.max(fivePct, weekPct))
  // When the weekly limit drives the warning color, say so next to the bar —
  // otherwise an orange bar at "12%" reads as a glitch.
  const weekDrives = level !== 'normal' && weekPct > fivePct
  const resetTime = fiveHour ? formatResetTime(fiveHour.resetsAt) : null

  return (
    <div
      className="relative mb-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${LEVEL_BAR[level]}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {Math.round(fivePct)}%{resetTime ? ` · ${resetTime}` : ''}
          {weekDrives ? ` · wk ${Math.round(weekPct)}%` : ''}
        </span>
      </div>
      {hovered && (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 bg-popover border border-border rounded-md shadow-lg py-1.5 px-2 text-xs whitespace-nowrap">
          {fiveHour && (
            <DetailRow
              label="5h window"
              value={`${Math.round(fiveHour.utilization)}% · resets ${formatResetTime(fiveHour.resetsAt) ?? '?'}`}
            />
          )}
          {week && (
            <DetailRow
              label="Week"
              value={`${Math.round(week.utilization)}% · resets ${formatResetTime(week.resetsAt) ?? '?'}`}
            />
          )}
          {usageData.sevenDaySonnet && (
            <DetailRow
              label="Week (Sonnet)"
              value={`${Math.round(usageData.sevenDaySonnet.utilization)}%`}
            />
          )}
          {usageData.extraUsage && (
            <DetailRow
              label="Extra usage"
              value={formatCredits(usageData.extraUsage.usedCredits, usageData.extraUsage.currency)}
            />
          )}
        </div>
      )}
    </div>
  )
}
