/**
 * Rate-limits WebGL renderer re-creation after context loss. A GPU reset loses
 * the context once and recovery is cheap; a broken driver loses it repeatedly,
 * and re-creating forever would thrash. Allow `maxRecoveries` within
 * `windowMs`; beyond that the terminal stays on the DOM renderer.
 */
export interface ContextLossPolicyOptions {
  maxRecoveries?: number
  windowMs?: number
  now?: () => number
}

export interface ContextLossPolicy {
  /** Record a context loss; true when the addon should be re-created. */
  shouldRecover(): boolean
}

export function createContextLossPolicy({
  maxRecoveries = 3,
  windowMs = 60_000,
  now = Date.now,
}: ContextLossPolicyOptions = {}): ContextLossPolicy {
  let losses: number[] = []
  return {
    shouldRecover() {
      const t = now()
      losses = losses.filter((at) => t - at < windowMs)
      losses.push(t)
      return losses.length <= maxRecoveries
    },
  }
}
