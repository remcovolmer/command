export type UsageLevel = 'normal' | 'warning' | 'danger'

/** Threshold mapping for the indicator color: ≥90 danger, ≥70 warning. */
export function usageLevel(utilization: number): UsageLevel {
  if (utilization >= 90) return 'danger'
  if (utilization >= 70) return 'warning'
  return 'normal'
}

/**
 * Format a reset timestamp for display: "19:50" when the reset falls on the
 * same local day as `now`, "Mon 13:00" otherwise. Returns null for invalid
 * input so callers can omit the suffix instead of rendering garbage.
 */
export function formatResetTime(resetsAt: string, now: Date = new Date()): string | null {
  const date = new Date(resetsAt)
  if (isNaN(date.getTime())) return null
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return time
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${weekday} ${time}`
}

/**
 * Format extra-usage spend. Assumption: `used_credits` is in cents (observed
 * `7784.0` with currency EUR alongside a console value of €77,84-order
 * magnitude); verify against the Claude console if the displayed amount looks
 * off by 100x.
 */
export function formatCredits(usedCredits: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(usedCredits / 100)
  } catch {
    // Unknown currency code — fall back to a plain number
    return `${(usedCredits / 100).toFixed(2)} ${currency}`
  }
}
