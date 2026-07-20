import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import type { UsageData, UsageProvider } from '../../types'
import { AgentBadge } from '../AgentBadge'
import {
  formatResetTime,
  formatCredits,
  usageLevel,
  windowLabel,
  type UsageLevel,
} from '../../utils/usageFormat'

const LEVEL_BAR: Record<UsageLevel, string> = {
  normal: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

// Fixed order so rows don't reshuffle as each provider's data arrives.
const PROVIDER_ORDER: readonly UsageProvider[] = ['claude', 'codex']

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-popover-foreground tabular-nums">{value}</span>
    </div>
  )
}

/** Provider brand mark (Claude / OpenAI logo) used as the row identifier — the
 *  same marks the chat list uses, so a lone bar is never ambiguous. */
function ProviderMark({ provider }: { provider: UsageProvider }) {
  return <AgentBadge type={provider} className="text-muted-foreground" />
}

function Placeholder({ provider }: { provider?: UsageProvider }) {
  return (
    <div className="mb-1.5 flex items-center gap-2" title="Usage data unavailable — retrying">
      {provider && <ProviderMark provider={provider} />}
      <div className="flex-1 h-1 rounded-full bg-muted" />
      <span className="text-[10px] text-muted-foreground/50 shrink-0">usage n/a</span>
    </div>
  )
}

/**
 * One provider's usage row: a brand mark + a thin bar showing the rendered
 * (shortest present) window's utilization, colored by whichever window is
 * closest to binding, with details on hover.
 */
function UsageBar({ data, provider }: { data: UsageData; provider: UsageProvider }) {
  const [hovered, setHovered] = useState(false)

  // The row stays mounted when a provider flips to unavailable (the store merges
  // keys, never deletes), and the placeholder has no popover to fire
  // onMouseLeave — so reset hover here or the popover would reappear open when
  // data returns. Render-time state adjustment per the React "storing
  // information from previous renders" pattern.
  if (data.status !== 'ok') {
    if (hovered) setHovered(false)
    return <Placeholder provider={provider} />
  }

  const short = data.fiveHour
  const long = data.sevenDay
  // Rendered window = shortest present (weekly when there's no 5h window).
  const rendered = short ?? long
  const renderedPct = rendered?.utilization ?? 0
  const shortPct = short?.utilization ?? 0
  const longPct = long?.utilization ?? 0
  const level = usageLevel(Math.max(shortPct, longPct))
  const barWidth = Math.min(100, Math.max(0, renderedPct))
  // A longer window drives the color while a shorter one is on the bar — name it
  // so an orange bar at a low 5h % doesn't read as a glitch.
  const longDrives = level !== 'normal' && short !== undefined && long !== undefined && longPct > shortPct
  const resetTime = rendered ? formatResetTime(rendered.resetsAt) : null
  // When the rendered window isn't the 5h window (weekly-only Codex), prefix its
  // label so the percentage isn't misread as a 5h figure.
  const renderedPrefix = !short && rendered ? `${windowLabel(rendered, 'wk')} ` : ''

  return (
    <div
      className="relative mb-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-2">
        <ProviderMark provider={provider} />
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${LEVEL_BAR[level]}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {renderedPrefix}
          {Math.round(renderedPct)}%{resetTime ? ` · ${resetTime}` : ''}
          {longDrives && long ? ` · ${windowLabel(long, 'wk')} ${Math.round(longPct)}%` : ''}
        </span>
      </div>
      {hovered && (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 bg-popover border border-border rounded-md shadow-lg py-1.5 px-2 text-xs whitespace-nowrap">
          {short && (
            <DetailRow
              label="5h window"
              value={`${Math.round(short.utilization)}% · resets ${formatResetTime(short.resetsAt) ?? '?'}`}
            />
          )}
          {long && (
            <DetailRow
              label="Week"
              value={`${Math.round(long.utilization)}% · resets ${formatResetTime(long.resetsAt) ?? '?'}`}
            />
          )}
          {data.sevenDaySonnet && (
            <DetailRow
              label="Week (Sonnet)"
              value={`${Math.round(data.sevenDaySonnet.utilization)}%`}
            />
          )}
          {data.planType && <DetailRow label="Plan" value={data.planType} />}
          {data.credits?.hasCredits && <DetailRow label="Credits" value={data.credits.balance} />}
          {data.extraUsage && (
            <DetailRow
              label="Extra usage"
              value={formatCredits(data.extraUsage.usedCredits, data.extraUsage.currency)}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Plan-usage bars in the sidebar footer: one row per provider whose data is
 * present (Claude, Codex), each led by its brand mark and colored by whichever
 * limit is closest to binding.
 */
export function UsageIndicator() {
  const usageData = useProjectStore((s) => s.usageData)
  const showUsageIndicator = useProjectStore((s) => s.showUsageIndicator)

  // Toggled off is an intentional hide — render nothing.
  if (!showUsageIndicator) return null

  const present = PROVIDER_ORDER.filter((p) => usageData[p] !== undefined)

  // Enabled but nothing has arrived yet: keep a muted placeholder so the footer
  // stays present and "off" remains distinguishable from "no data".
  if (present.length === 0) return <Placeholder />

  return (
    <>
      {present.map((provider) => {
        const data = usageData[provider]
        if (!data) return null
        return <UsageBar key={provider} data={data} provider={provider} />
      })}
    </>
  )
}
