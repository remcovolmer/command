/**
 * Shared class-string primitives for buttons, inputs and small chrome pieces.
 * Not components — just Tailwind class strings, so callers stay free to use
 * plain <button>/<input> elements and compose with clsx() as needed. Centralizing
 * these keeps every dialog/panel/form on the same token-driven visual language
 * (see docs/plan/2026-09-04-design-overhaul.html, "Dialogen, knoppen en formulieren").
 */

export const btnPrimary =
  'inline-flex items-center gap-2 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary-hover active:scale-[0.97] transition-[background-color,transform] duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

export const btnSecondary =
  'inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border-strong bg-screen text-fg text-[13px] font-medium hover:bg-raised active:scale-[0.97] transition-[background-color,transform] duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

export const btnGhost =
  'inline-flex items-center gap-2 h-8 px-2.5 rounded-md text-fg-muted text-[13px] font-medium hover:bg-raised hover:text-fg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

export const btnIcon =
  'inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-muted hover:bg-raised hover:text-fg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

export const btnDanger =
  'inline-flex items-center gap-2 h-8 px-3 rounded-md bg-danger text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.97] transition-[opacity,transform] duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

export const input =
  'h-8 px-2.5 rounded-md bg-screen border border-border text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25'

export const select = input

export const textarea =
  'px-2.5 py-2 rounded-md bg-screen border border-border text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25'

export const kbd =
  'font-mono text-[11px] px-1.5 py-0.5 rounded border border-border-strong border-b-2 bg-screen text-fg'

export const card = 'rounded-lg border border-border bg-panel'

export const sectionTitle = 'text-[13px] font-semibold text-fg-strong'

export const sectionHint = 'text-[12.5px] text-fg-muted'

/** Segmented control (Settings tabs, theme choice, mode buttons). */
export const segmentGroup = 'inline-flex p-0.5 rounded-lg bg-raised'

export const segment = 'h-7 px-3 rounded-md text-[12.5px] font-medium transition-colors duration-150'

export const segmentActive = 'bg-screen text-fg-strong shadow-[0_1px_2px_oklch(0_0_0/.08)]'

export const segmentInactive = 'text-fg-muted hover:text-fg'
