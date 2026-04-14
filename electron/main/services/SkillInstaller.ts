import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Installs the ccli skill as a global Claude Code skill (~/.claude/skills/ccli/skill.md).
 *
 * Previously this injected a command file into each project's .claude/commands/.
 * Now it installs once globally, which is cleaner and avoids gitignore pollution.
 * Also cleans up legacy per-project command files from older versions.
 */
export class SkillInstaller {
  private readonly SKILL_VERSION = 'ccli-skill-v1'
  private readonly skillTemplate: string
  private readonly globalSkillDir: string
  private readonly globalSkillPath: string

  constructor() {
    this.globalSkillDir = join(homedir(), '.claude', 'skills', 'ccli')
    this.globalSkillPath = join(this.globalSkillDir, 'skill.md')
    this.skillTemplate = this.loadTemplate()
  }

  /**
   * Install or update the global ccli skill.
   * Idempotent: skips if the current version is already installed.
   */
  async install(): Promise<void> {
    try {
      const currentVersion = this.readCurrentVersion(this.globalSkillPath)

      if (currentVersion === this.SKILL_VERSION) {
        return // Already up to date
      }

      if (!existsSync(this.globalSkillDir)) {
        mkdirSync(this.globalSkillDir, { recursive: true })
      }

      writeFileSync(this.globalSkillPath, this.skillTemplate, 'utf-8')
      console.log(`[SkillInstaller] ${currentVersion ? 'Updated' : 'Installed'} global ccli skill`)
    } catch (e) {
      console.error('[SkillInstaller] Failed to install global skill:', e)
    }
  }

  /**
   * Remove legacy per-project command file (.claude/commands/ccli.md).
   * Call this for each project to clean up old installations.
   */
  async cleanupLegacyCommand(projectPath: string): Promise<void> {
    try {
      const legacyPath = join(projectPath, '.claude', 'commands', 'ccli.md')
      if (existsSync(legacyPath)) {
        unlinkSync(legacyPath)
        console.log(`[SkillInstaller] Removed legacy command from ${projectPath}`)
      }
    } catch (e) {
      // Non-critical — log and move on
      console.error(`[SkillInstaller] Failed to clean up legacy command in ${projectPath}:`, e)
    }
  }

  /**
   * Read the version comment from the first line of a skill file.
   */
  private readCurrentVersion(skillPath: string): string | null {
    if (!existsSync(skillPath)) {
      return null
    }

    try {
      const content = readFileSync(skillPath, 'utf-8')
      const firstLine = content.split('\n')[0]
      const match = firstLine.match(/^<!--\s*(ccli-skill-v\d+)\s*-->/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Load the skill template from the bundled template file, with embedded fallback.
   */
  private loadTemplate(): string {
    try {
      const templatePath = join(__dirname, '..', 'templates', 'ccli-skill.md')
      if (existsSync(templatePath)) {
        return readFileSync(templatePath, 'utf-8')
      }
    } catch {
      // Fall through to embedded template
    }

    return `<!-- ${this.SKILL_VERSION} -->
# ccli \u2014 Command Center CLI

You are running inside a **Command** terminal. The \`ccli\` CLI lets you control the app. Use it when it adds value to the current task \u2014 don't be preemptive.

## Worktrees

**Always use \`ccli worktree create <name>\` instead of \`git worktree add\`.** This creates the worktree AND upgrades your chat so the sidebar, file explorer, and PR polling all work correctly. After running, \`cd\` to the path returned in the output.

\`\`\`bash
ccli worktree create feat-auth              # creates worktree + upgrades chat
ccli worktree create feat-auth --source dev  # branch from dev instead of default
ccli worktree link /path/to/existing         # link a pre-existing worktree (rare)
ccli worktree merge                          # merge the current worktree's PR
\`\`\`

**Never use \`git worktree add\` directly** \u2014 Command cannot track worktrees it didn't create.

## Files & Diffs

Show files and diffs to the user in Command's editor:

\`\`\`bash
ccli open src/App.tsx                  # open file in editor
ccli open src/App.tsx --line 42        # open at specific line
ccli diff src/App.tsx                  # show git diff for file
\`\`\`

## Communication

\`\`\`bash
ccli title "Auth refactor"             # name this chat based on the task
ccli status "Running test suite..."    # show current activity in the UI
ccli notify "Tests passed"             # OS notification (use for long tasks)
\`\`\`

## Sidecar Terminals

Run and monitor background processes without interrupting this chat:

\`\`\`bash
ccli sidecar create                    # create a sidecar terminal
ccli sidecar exec <id> "npm test"      # run a command in it
ccli sidecar read <id>                 # read recent output
ccli sidecar list                      # list active sidecars
\`\`\`

## Discovery

\`\`\`bash
ccli chat list                         # see other active sessions
ccli project list                      # list managed projects
ccli project create /path/to/repo      # add a project to Command
\`\`\`
`
  }
}
