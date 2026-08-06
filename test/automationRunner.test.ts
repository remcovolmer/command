import { describe, test, expect, vi } from 'vitest'
import { AutomationRunner } from '../electron/main/services/AutomationRunner'
import type { WorktreeService } from '../electron/main/services/WorktreeService'

function createMockWorktreeService(worktrees: Array<{ path: string; branch: string; isMain: boolean }> = []): WorktreeService {
  return {
    listWorktrees: vi.fn().mockResolvedValue(worktrees),
    createWorktree: vi.fn().mockResolvedValue({ path: '/tmp/wt', branch: 'test' }),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    hasChanges: vi.fn().mockResolvedValue(false),
  } as unknown as WorktreeService
}

describe('AutomationRunner', () => {
  describe('garbageCollectWorktrees', () => {
    const oldTimestamp = Date.now() - 48 * 60 * 60 * 1000 // 48 hours ago

    test('skips worktrees with unmerged commits even when git status is clean', async () => {
      const worktrees = [
        { path: '/repo', branch: 'main', isMain: true },
        {
          path: `/repo/.worktrees/auto-abcd1234-${oldTimestamp}`,
          branch: `auto-abcd1234-${oldTimestamp}`,
          isMain: false,
        },
      ]
      const mockWts = createMockWorktreeService(worktrees)
      const runner = new AutomationRunner(mockWts)

      // Stub private methods to simulate: clean status but unmerged commits
      const anyRunner = runner as Record<string, unknown>
      anyRunner.worktreeHasChanges = vi.fn().mockResolvedValue(false)
      anyRunner.hasUnmergedCommits = vi.fn().mockResolvedValue(true)
      anyRunner.cleanupWorktree = vi.fn().mockResolvedValue(undefined)

      const cleaned = await runner.garbageCollectWorktrees('/repo')

      // Should NOT clean up because the worktree has unmerged commits
      expect(cleaned).toBe(0)
      expect(anyRunner.cleanupWorktree).not.toHaveBeenCalled()
    })

    test('cleans up worktrees whose commits exist on a non-auto branch', async () => {
      const worktrees = [
        { path: '/repo', branch: 'main', isMain: true },
        {
          path: `/repo/.worktrees/auto-abcd1234-${oldTimestamp}`,
          branch: `auto-abcd1234-${oldTimestamp}`,
          isMain: false,
        },
      ]
      const mockWts = createMockWorktreeService(worktrees)
      const runner = new AutomationRunner(mockWts)

      const anyRunner = runner as Record<string, unknown>
      anyRunner.worktreeHasChanges = vi.fn().mockResolvedValue(false)
      anyRunner.hasUnmergedCommits = vi.fn().mockResolvedValue(false)
      anyRunner.cleanupWorktree = vi.fn().mockResolvedValue(undefined)

      const cleaned = await runner.garbageCollectWorktrees('/repo')

      expect(cleaned).toBe(1)
      expect(anyRunner.cleanupWorktree).toHaveBeenCalled()
    })

    test('skips main branch worktrees', async () => {
      const worktrees = [
        { path: '/repo', branch: 'main', isMain: true },
      ]
      const mockWts = createMockWorktreeService(worktrees)
      const runner = new AutomationRunner(mockWts)

      const cleaned = await runner.garbageCollectWorktrees('/repo')
      expect(cleaned).toBe(0)
    })

    test('skips worktrees with uncommitted changes', async () => {
      const worktrees = [
        { path: '/repo', branch: 'main', isMain: true },
        {
          path: `/repo/.worktrees/auto-abcd1234-${oldTimestamp}`,
          branch: `auto-abcd1234-${oldTimestamp}`,
          isMain: false,
        },
      ]
      const mockWts = createMockWorktreeService(worktrees)
      const runner = new AutomationRunner(mockWts)

      const anyRunner = runner as Record<string, unknown>
      anyRunner.worktreeHasChanges = vi.fn().mockResolvedValue(true)
      anyRunner.hasUnmergedCommits = vi.fn().mockResolvedValue(false)
      anyRunner.cleanupWorktree = vi.fn().mockResolvedValue(undefined)

      const cleaned = await runner.garbageCollectWorktrees('/repo')
      expect(cleaned).toBe(0)
      // hasUnmergedCommits should not even be called if worktreeHasChanges is true
      expect(anyRunner.hasUnmergedCommits).not.toHaveBeenCalled()
    })

    test('skips non-auto branches', async () => {
      const worktrees = [
        { path: '/repo', branch: 'main', isMain: true },
        {
          path: '/repo/.worktrees/feature-branch',
          branch: 'feature-branch',
          isMain: false,
        },
      ]
      const mockWts = createMockWorktreeService(worktrees)
      const runner = new AutomationRunner(mockWts)

      const cleaned = await runner.garbageCollectWorktrees('/repo')
      expect(cleaned).toBe(0)
    })

    test('skips worktrees younger than 24 hours', async () => {
      const recentTimestamp = Date.now() - 1 * 60 * 60 * 1000 // 1 hour ago
      const worktrees = [
        { path: '/repo', branch: 'main', isMain: true },
        {
          path: `/repo/.worktrees/auto-abcd1234-${recentTimestamp}`,
          branch: `auto-abcd1234-${recentTimestamp}`,
          isMain: false,
        },
      ]
      const mockWts = createMockWorktreeService(worktrees)
      const runner = new AutomationRunner(mockWts)

      const anyRunner = runner as Record<string, unknown>
      anyRunner.cleanupWorktree = vi.fn().mockResolvedValue(undefined)

      const cleaned = await runner.garbageCollectWorktrees('/repo')
      expect(cleaned).toBe(0)
    })
  })
})
