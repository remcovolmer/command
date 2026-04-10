import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SkillInstaller } from '../electron/main/services/SkillInstaller'

describe('SkillInstaller', () => {
  let tempDir: string
  let installer: SkillInstaller

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-installer-test-'))
    installer = new SkillInstaller()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function skillPath(): string {
    return join(tempDir, '.claude', 'commands', 'ccli.md')
  }

  function gitignorePath(): string {
    return join(tempDir, '.gitignore')
  }

  test('creates skill file when missing', async () => {
    await installer.installOrUpdate(tempDir)

    expect(existsSync(skillPath())).toBe(true)
    const content = readFileSync(skillPath(), 'utf-8')
    expect(content).toContain('<!-- ccli-skill-v1 -->')
    expect(content).toContain('ccli worktree create')
  })

  test('creates .claude/commands/ directory if missing', async () => {
    const commandsDir = join(tempDir, '.claude', 'commands')
    expect(existsSync(commandsDir)).toBe(false)

    await installer.installOrUpdate(tempDir)

    expect(existsSync(commandsDir)).toBe(true)
  })

  test('updates skill file when version is outdated', async () => {
    // Create an older version
    const commandsDir = join(tempDir, '.claude', 'commands')
    mkdirSync(commandsDir, { recursive: true })
    writeFileSync(skillPath(), '<!-- ccli-skill-v0 -->\nOld content', 'utf-8')

    await installer.installOrUpdate(tempDir)

    const content = readFileSync(skillPath(), 'utf-8')
    expect(content).toContain('<!-- ccli-skill-v1 -->')
    expect(content).not.toContain('Old content')
  })

  test('skips when version matches', async () => {
    // Install first
    await installer.installOrUpdate(tempDir)
    const firstContent = readFileSync(skillPath(), 'utf-8')

    // Append something to detect overwrites
    writeFileSync(skillPath(), firstContent + '\n# User addition', 'utf-8')

    // Install again — should not overwrite because version matches
    await installer.installOrUpdate(tempDir)

    const finalContent = readFileSync(skillPath(), 'utf-8')
    // The version line is still first, so version check passes.
    // The file should NOT be rewritten since version matches.
    expect(finalContent).toContain('# User addition')
  })

  test('adds .gitignore entry', async () => {
    await installer.installOrUpdate(tempDir)

    expect(existsSync(gitignorePath())).toBe(true)
    const content = readFileSync(gitignorePath(), 'utf-8')
    expect(content).toContain('.claude/commands/ccli.md')
  })

  test('does not duplicate .gitignore entry', async () => {
    // Pre-create .gitignore with the entry
    writeFileSync(gitignorePath(), 'node_modules\n.claude/commands/ccli.md\n', 'utf-8')

    await installer.installOrUpdate(tempDir)

    const content = readFileSync(gitignorePath(), 'utf-8')
    const matches = content.split('.claude/commands/ccli.md').length - 1
    expect(matches).toBe(1)
  })

  test('appends to existing .gitignore without duplicating', async () => {
    writeFileSync(gitignorePath(), 'node_modules\ndist\n', 'utf-8')

    await installer.installOrUpdate(tempDir)

    const content = readFileSync(gitignorePath(), 'utf-8')
    expect(content).toContain('node_modules')
    expect(content).toContain('dist')
    expect(content).toContain('.claude/commands/ccli.md')
  })

  test('handles .gitignore without trailing newline', async () => {
    writeFileSync(gitignorePath(), 'node_modules', 'utf-8')

    await installer.installOrUpdate(tempDir)

    const content = readFileSync(gitignorePath(), 'utf-8')
    // Should have a newline between existing content and new entry
    expect(content).toBe('node_modules\n.claude/commands/ccli.md\n')
  })

  test('skips gracefully when project path does not exist', async () => {
    const bogusPath = join(tempDir, 'nonexistent')

    // Should not throw
    await installer.installOrUpdate(bogusPath)

    expect(existsSync(join(bogusPath, '.claude'))).toBe(false)
  })

  test('skill file contains key instructions', async () => {
    await installer.installOrUpdate(tempDir)

    const content = readFileSync(skillPath(), 'utf-8')
    expect(content).toContain('ccli worktree create')
    expect(content).toContain('git worktree add')
    expect(content).toContain('ccli open')
    expect(content).toContain('ccli notify')
    expect(content).toContain('ccli status')
    expect(content).toContain('ccli title')
    expect(content).toContain('ccli sidecar')
    expect(content).toContain('ccli chat list')
    expect(content).toContain('ccli diff')
    expect(content).toContain('ccli worktree merge')
  })

  test('is idempotent — multiple calls produce same result', async () => {
    await installer.installOrUpdate(tempDir)
    const firstContent = readFileSync(skillPath(), 'utf-8')
    const firstGitignore = readFileSync(gitignorePath(), 'utf-8')

    await installer.installOrUpdate(tempDir)
    // Skill file should be identical (not rewritten since version matches)
    expect(readFileSync(skillPath(), 'utf-8')).toBe(firstContent)
    // Gitignore should not have duplicate entries
    expect(readFileSync(gitignorePath(), 'utf-8')).toBe(firstGitignore)
  })
})
