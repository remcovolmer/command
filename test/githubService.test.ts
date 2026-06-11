import { describe, test, expect, vi, beforeEach } from 'vitest'

type ExecFileCb = (
  err: (Error & { stderr?: string; code?: number }) | null,
  result?: { stdout: string; stderr: string }
) => void

// Per-test stub that child_process.execFile delegates to.
let execFileStub: (args: string[]) => Promise<{ stdout: string; stderr: string }> = async () => ({
  stdout: '',
  stderr: '',
})

vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: ExecFileCb) => {
    execFileStub(args).then(
      (result) => cb(null, result),
      (err) => cb(err as Error & { stderr?: string })
    )
  },
}))

// Capture the service's scoped logger for warn assertions
const loggerSpies = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}))
vi.mock('../electron/main/services/Logger', () => ({
  createLogger: () => loggerSpies,
}))

// Import after mock so promisify wraps the stub.
import { GitHubService, TransientGhError } from '../electron/main/services/GitHubService'

function setStub(fn: typeof execFileStub) {
  execFileStub = fn
}

function ghError(stderr: string): Error & { stderr: string; code: number } {
  const err = new Error('Command failed') as Error & { stderr: string; code: number }
  err.stderr = stderr
  err.code = 1
  return err
}

describe('GitHubService.getPRStatus', () => {
  let service: GitHubService

  beforeEach(() => {
    service = new GitHubService()
    execFileStub = async () => ({ stdout: '', stderr: '' })
  })

  test('returns parsed PR status on success', async () => {
    setStub(async () => ({
      stdout: JSON.stringify({
        number: 42,
        title: 'feat: thing',
        state: 'OPEN',
        url: 'https://example.test/pr/42',
        headRefName: 'feature/thing',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
        additions: 10,
        deletions: 2,
        changedFiles: 1,
      }),
      stderr: '',
    }))

    const status = await service.getPRStatus('/project')

    expect(status.noPR).toBe(false)
    expect(status.number).toBe(42)
    expect(status.state).toBe('OPEN')
    expect(status.statusCheckRollup?.[0]).toEqual({
      name: 'ci',
      state: 'COMPLETED',
      bucket: 'pass',
    })
    expect(status.error).toBeUndefined()
  })

  test('returns noPR=true when gh reports no pull requests', async () => {
    setStub(async () => {
      throw ghError('no pull requests found for branch "feature/thing"\n')
    })

    const status = await service.getPRStatus('/project')

    expect(status.noPR).toBe(true)
    expect(status.error).toBeUndefined()
    expect(status.stale).toBeUndefined()
  })

  test('returns noPR=true when gh cannot resolve the repo', async () => {
    setStub(async () => {
      throw ghError('Could not resolve to a Repository with the name')
    })

    const status = await service.getPRStatus('/project')

    expect(status.noPR).toBe(true)
  })

  test('throws TransientGhError on generic gh failure (does NOT collapse to noPR)', async () => {
    setStub(async () => {
      throw ghError('error connecting to api.github.com: dial tcp: i/o timeout')
    })

    await expect(service.getPRStatus('/project')).rejects.toBeInstanceOf(TransientGhError)
  })

  test('throws TransientGhError on auth-token failure', async () => {
    setStub(async () => {
      throw ghError('gh auth status: not logged in')
    })

    await expect(service.getPRStatus('/project')).rejects.toBeInstanceOf(TransientGhError)
  })

  test('throws TransientGhError when gh exits without stderr (e.g., killed/timeout)', async () => {
    setStub(async () => {
      throw new Error('Command timed out')
    })

    await expect(service.getPRStatus('/project')).rejects.toBeInstanceOf(TransientGhError)
  })
})

describe('GitHubService PR event listeners', () => {
  test('a throwing listener logs a warning and does not stop other listeners', () => {
    vi.clearAllMocks()
    const service = new GitHubService()
    const prContext = {
      number: 42,
      title: 'feat: thing',
      branch: 'feature/thing',
      url: 'https://example.test/pr/42',
      mergeable: 'MERGEABLE',
      state: 'OPEN',
    }

    const throwing = vi.fn(() => {
      throw new Error('listener boom')
    })
    const healthy = vi.fn()
    service.onPREvent(throwing)
    service.onPREvent(healthy)

    // Drive the private emitter directly (poll plumbing is not under test here)
    ;(
      service as unknown as {
        emitPREvent(projectPath: string, event: string, ctx: typeof prContext): void
      }
    ).emitPREvent('/project', 'pr-merged', prContext)

    expect(throwing).toHaveBeenCalled()
    expect(healthy).toHaveBeenCalledWith('/project', 'pr-merged', prContext)
    expect(loggerSpies.warn).toHaveBeenCalledWith('PR event listener threw:', expect.any(Error))
  })
})
