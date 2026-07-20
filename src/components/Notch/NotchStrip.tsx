import { useEffect, useState } from 'react'
import { getElectronAPI } from '../../utils/electron'
import type { NotchSession } from '../../types'

/**
 * The notch strip renderer view, mounted in the dedicated strip window
 * (see src/main.tsx `#strip` branch). U3 subscribes to the cross-project
 * session feed relayed from the main process; the collapsed/expanded UI, hide
 * button, and click routing arrive in U5/U6.
 */
export function NotchStrip(): React.JSX.Element {
  const [sessions, setSessions] = useState<NotchSession[]>([])

  useEffect(() => {
    return getElectronAPI().notch.onState((payload) => setSessions(payload.sessions))
  }, [])

  return (
    <div
      data-testid="notch-strip"
      className="notch-strip flex select-none items-center gap-2 px-3 py-2 text-xs"
    >
      {/* Provisional readout; U5 renders the collapsed/expanded session UI. */}
      <span data-testid="notch-count">{sessions.length}</span>
    </div>
  )
}
