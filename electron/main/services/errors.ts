export type SpawnErrorCode = 'CWD_MISSING' | 'CWD_NOT_DIR' | 'SPAWN_FAILED'

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
    super(options?.message ?? defaultMessage)
    this.name = 'SpawnError'
    this.code = code
    this.cwd = cwd
    if (options?.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

export function isSpawnError(err: unknown): err is SpawnError {
  return err instanceof SpawnError
}
