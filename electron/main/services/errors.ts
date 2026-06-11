// Canonical definition lives in src/types so the renderer, preload, and main
// share one union the compiler can enforce across the process boundary.
import type { SpawnFailureCode } from '../../../src/types'

export type SpawnErrorCode = SpawnFailureCode

export class SpawnError extends Error {
  readonly code: SpawnErrorCode
  readonly cwd: string

  constructor(code: SpawnErrorCode, cwd: string, options?: { cause?: unknown; message?: string }) {
    const defaultMessage =
      code === 'CWD_MISSING'
        ? `Working directory does not exist: ${cwd}`
        : code === 'CWD_NOT_DIR'
          ? `Path is not a directory: ${cwd}`
          : `Failed to spawn shell in ${cwd}`
    super(
      options?.message ?? defaultMessage,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    )
    this.name = 'SpawnError'
    this.code = code
    this.cwd = cwd
  }
}

export function isSpawnError(err: unknown): err is SpawnError {
  return err instanceof SpawnError
}
