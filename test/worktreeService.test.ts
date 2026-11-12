import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { WorktreeService } from '../electron/main/services/WorktreeService'

const service = new WorktreeService()
const project = path.resolve(path.join(os.tmpdir(), 'wt-project'))
const p = (...segs: string[]) => path.join(project, ...segs)

describe('WorktreeService.getWorktreesDir', () => {
  it('places new worktrees under .claude/worktrees', () => {
    expect(service.getWorktreesDir(project)).toBe(p('.claude', 'worktrees'))
  })
})

describe('WorktreeService.isWorktreePath', () => {
  it('accepts paths under .claude/worktrees', () => {
    expect(service.isWorktreePath(project, p('.claude', 'worktrees', 'feat-x'))).toBe(true)
    expect(service.isWorktreePath(project, p('.claude', 'worktrees', 'feat-x', 'src'))).toBe(true)
  })

  it('accepts paths under the legacy .worktrees directory', () => {
    expect(service.isWorktreePath(project, p('.worktrees', 'feat-x'))).toBe(true)
  })

  it('rejects look-alike and unrelated paths', () => {
    expect(service.isWorktreePath(project, p('.claude', 'worktrees-evil', 'x'))).toBe(false)
    expect(service.isWorktreePath(project, p('.claude', 'settings.json'))).toBe(false)
    expect(service.isWorktreePath(project, p('.claude'))).toBe(false)
    expect(service.isWorktreePath(project, p('.worktrees-evil', 'x'))).toBe(false)
    expect(service.isWorktreePath(project, p('worktrees', 'x'))).toBe(false)
    expect(service.isWorktreePath(project, p('src'))).toBe(false)
    expect(service.isWorktreePath(project, project)).toBe(false)
    expect(service.isWorktreePath(project, p('.claude', 'worktrees', '..', '..', 'src'))).toBe(false)
    expect(
      service.isWorktreePath(project, path.join(os.tmpdir(), 'other', '.claude', 'worktrees', 'x'))
    ).toBe(false)
  })

  it.runIf(process.platform === 'win32')('matches case-insensitively on Windows', () => {
    expect(service.isWorktreePath(project, p('.Claude', 'Worktrees', 'feat-x'))).toBe(true)
  })
})

describe('WorktreeService.ensureWorktreesDir', () => {
  let dir: string
  const gitignore = () => readFileSync(path.join(dir, '.gitignore'), 'utf-8')

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'wt-svc-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates .claude/worktrees recursively and a .gitignore with the entry', async () => {
    await service.ensureWorktreesDir(dir)
    expect(existsSync(path.join(dir, '.claude', 'worktrees'))).toBe(true)
    expect(gitignore()).toBe('.claude/worktrees/\n')
  })

  it('appends the entry to an existing .gitignore and never adds .worktrees', async () => {
    writeFileSync(path.join(dir, '.gitignore'), 'node_modules')
    await service.ensureWorktreesDir(dir)
    expect(gitignore()).toBe('node_modules\n.claude/worktrees/\n')
  })

  it('keeps an existing legacy .worktrees entry in place', async () => {
    writeFileSync(path.join(dir, '.gitignore'), '.worktrees\n')
    await service.ensureWorktreesDir(dir)
    expect(gitignore()).toBe('.worktrees\n.claude/worktrees/\n')
  })

  it.each([
    '.claude/worktrees',
    '/.claude/worktrees',
    '.claude/worktrees/',
    '/.claude/worktrees/',
    '.claude',
    '/.claude',
    '.claude/',
    '/.claude/',
  ])('treats "%s" as already ignored', async (line) => {
    const content = `dist\r\n${line}\r\n`
    writeFileSync(path.join(dir, '.gitignore'), content)
    await service.ensureWorktreesDir(dir)
    expect(gitignore()).toBe(content)
  })

  it('does not treat unrelated .claude entries as covering worktrees', async () => {
    writeFileSync(path.join(dir, '.gitignore'), '.claude/settings.local.json\n')
    await service.ensureWorktreesDir(dir)
    expect(gitignore()).toBe('.claude/settings.local.json\n.claude/worktrees/\n')
  })

  it('is idempotent', async () => {
    await service.ensureWorktreesDir(dir)
    await service.ensureWorktreesDir(dir)
    expect(gitignore()).toBe('.claude/worktrees/\n')
  })
})
