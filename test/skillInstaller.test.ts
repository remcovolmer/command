import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SkillInstaller } from '../electron/main/services/SkillInstaller'

// Mock homedir to use a temp directory so we don't touch the real ~/.claude
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    homedir: () => (globalThis as Record<string, string>).__TEST_HOMEDIR__ ?? actual.homedir(),
  }
})

describe('SkillInstaller', () => {
  let fakeHome: string
  let projectDir: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'skill-installer-home-'))
    ;(globalThis as Record<string, string>).__TEST_HOMEDIR__ = fakeHome
    projectDir = mkdtempSync(join(tmpdir(), 'skill-installer-project-'))
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
    delete (globalThis as Record<string, string>).__TEST_HOMEDIR__
  })

  function globalSkillPath(): string {
    return join(fakeHome, '.claude', 'skills', 'ccli', 'skill.md')
  }

  function legacyCommandPath(): string {
    return join(projectDir, '.claude', 'commands', 'ccli.md')
  }

  test('installs global skill when missing', async () => {
    const installer = new SkillInstaller()
    await installer.install()

    expect(existsSync(globalSkillPath())).toBe(true)
    const content = readFileSync(globalSkillPath(), 'utf-8')
    expect(content).toContain('<!-- ccli-skill-v3 -->')
    expect(content).toContain('ccli worktree create')
    // Skill discovery needs real YAML frontmatter at the very top — a name and
    // a description Claude Code can use as the invocation trigger. Match
    // line-ending-agnostically (the installed file may be CRLF on Windows).
    expect(content).toMatch(/^---\r?\n/)
    expect(content).toMatch(/^name:\s*ccli\s*$/m)
    expect(content).toMatch(/^description:\s*\S/m)
  })

  test('version is detected even though the comment follows the frontmatter', async () => {
    const installer = new SkillInstaller()
    await installer.install()
    const firstContent = readFileSync(globalSkillPath(), 'utf-8')

    // A second install must recognize the current version (scanning past the
    // frontmatter) and skip — not clobber user edits by failing to detect it.
    writeFileSync(globalSkillPath(), firstContent + '\n# User addition', 'utf-8')
    await installer.install()

    expect(readFileSync(globalSkillPath(), 'utf-8')).toContain('# User addition')
  })

  test('creates ~/.claude/skills/ccli/ directory', async () => {
    const skillDir = join(fakeHome, '.claude', 'skills', 'ccli')
    expect(existsSync(skillDir)).toBe(false)

    const installer = new SkillInstaller()
    await installer.install()

    expect(existsSync(skillDir)).toBe(true)
  })

  test('skips when version matches', async () => {
    const installer = new SkillInstaller()
    await installer.install()
    const firstContent = readFileSync(globalSkillPath(), 'utf-8')

    // Append something to detect overwrites
    writeFileSync(globalSkillPath(), firstContent + '\n# User addition', 'utf-8')

    await installer.install()

    const finalContent = readFileSync(globalSkillPath(), 'utf-8')
    expect(finalContent).toContain('# User addition')
  })

  test('updates when version is outdated', async () => {
    const skillDir = join(fakeHome, '.claude', 'skills', 'ccli')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(globalSkillPath(), '<!-- ccli-skill-v0 -->\nOld content', 'utf-8')

    const installer = new SkillInstaller()
    await installer.install()

    const content = readFileSync(globalSkillPath(), 'utf-8')
    expect(content).toContain('<!-- ccli-skill-v3 -->')
    expect(content).not.toContain('Old content')
  })

  test('removes legacy per-project command file', async () => {
    const commandsDir = join(projectDir, '.claude', 'commands')
    mkdirSync(commandsDir, { recursive: true })
    writeFileSync(legacyCommandPath(), '<!-- ccli-skill-v1 -->\nOld', 'utf-8')

    const installer = new SkillInstaller()
    await installer.cleanupLegacyCommand(projectDir)

    expect(existsSync(legacyCommandPath())).toBe(false)
  })

  test('cleanup is safe when no legacy file exists', async () => {
    const installer = new SkillInstaller()
    // Should not throw
    await installer.cleanupLegacyCommand(projectDir)
    expect(existsSync(legacyCommandPath())).toBe(false)
  })

  test('is idempotent — multiple installs produce same result', async () => {
    const installer = new SkillInstaller()
    await installer.install()
    const firstContent = readFileSync(globalSkillPath(), 'utf-8')

    await installer.install()
    expect(readFileSync(globalSkillPath(), 'utf-8')).toBe(firstContent)
  })

  test('skill file contains key instructions', async () => {
    const installer = new SkillInstaller()
    await installer.install()

    const content = readFileSync(globalSkillPath(), 'utf-8')
    expect(content).toContain('ccli worktree create')
    expect(content).toContain('git worktree add')
    expect(content).toContain('ccli open')
    expect(content).toContain('ccli notify')
    expect(content).toContain('ccli status')
    expect(content).toContain('ccli title')
    expect(content).toContain('ccli sidecar')
    expect(content).toContain('ccli chat list')
    expect(content).not.toContain('ccli diff')
    expect(content).toContain('ccli worktree merge')
  })
})
