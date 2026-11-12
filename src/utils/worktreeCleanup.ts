import type { TerminalSession } from '../types'
import { getElectronAPI } from './electron'

/**
 * Close every terminal of a worktree and remove them from the store, then wait
 * for Windows to release file handles.
 *
 * Closes regardless of state: 'stopped' only means the agent ended — after a
 * Claude `SessionEnd` the shell PTY is still alive and holds the worktree's
 * files open. Closing an already-exited PTY is a no-op in the main process.
 */
export async function closeWorktreeTerminals(
  terminals: TerminalSession[],
  removeTerminal: (id: string) => void
): Promise<void> {
  const api = getElectronAPI()
  terminals.forEach((t) => api.terminal.close(t.id))
  terminals.forEach((t) => removeTerminal(t.id))
  if (terminals.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
