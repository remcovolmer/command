/**
 * The notch strip renderer view, mounted in the dedicated strip window
 * (see src/main.tsx `#strip` branch). U1 renders a skeleton container; the
 * live session list, collapsed/expanded states, hide button, and click
 * routing arrive in U5.
 */
export function NotchStrip(): React.JSX.Element {
  return (
    <div
      data-testid="notch-strip"
      className="notch-strip flex select-none items-center gap-2 px-3 py-2 text-xs"
    >
      {/* Session pills populated in U5 */}
    </div>
  )
}
