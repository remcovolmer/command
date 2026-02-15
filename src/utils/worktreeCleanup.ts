import type { TerminalSession } from '../types'
import { getElectronAPI } from './electron'

/**
 * Close active terminals and remove them from the store,
 * then wait for Windows to release file handles.
 */
export async function closeWorktreeTerminals(
  terminals: TerminalSession[],
  removeTerminal: (id: string) => void
): Promise<void> {
  const api = getElectronAPI()
  const active = terminals.filter((t) => t.state !== 'stopped')
  active.forEach((t) => {
    api.terminal.close(t.id)
    removeTerminal(t.id)
  })
  if (active.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
