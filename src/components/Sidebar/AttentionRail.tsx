// Shared attention treatment for sidebar rows (chat rows and worktree rows).
// Permission/question states must look identical everywhere per the
// attention-state contract (see isAttentionState in utils/terminalState.ts);
// keeping rail, chip and row tint in one place prevents the two row types
// from drifting apart.

/** Base classes for small status chips (attention chip, PR badge). */
export const CHIP_BASE =
  'text-[10px] leading-none font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap'

/** 3px left-edge bar for permission/question rows (.attention-pulse animates it). */
export function AttentionRail() {
  return (
    <span
      data-testid="attention-rail"
      aria-hidden="true"
      className="attention-pulse absolute inset-y-0 left-0 w-[3px] rounded-full bg-[var(--status-attention)] pointer-events-none"
    />
  )
}

/** Chip telling the user a permission/question row needs them. */
export function AttentionChip() {
  return (
    <span
      className={`${CHIP_BASE} flex-shrink-0 bg-[color-mix(in_oklch,var(--status-attention)_18%,transparent)] text-[var(--status-attention)]`}
    >
      wacht op jou
    </span>
  )
}

/** Row background: attention tint mixed into the active/inactive base. */
export function attentionRowBg(isAttention: boolean, isActive: boolean): string {
  if (isActive) {
    return isAttention
      ? 'bg-[color-mix(in_oklch,var(--status-attention)_14%,var(--sidebar-highlight))]'
      : 'bg-[var(--sidebar-highlight)]'
  }
  return isAttention
    ? 'bg-[color-mix(in_oklch,var(--status-attention)_8%,transparent)]'
    : 'hover:bg-muted/50'
}
