import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Auto-installs the ccli skill file into every managed project.
 *
 * The skill file (.claude/commands/ccli.md) teaches Claude Code about
 * the ccli CLI and when to use each command. It is versioned so that
 * updates are applied automatically when the template changes.
 */
export class SkillInstaller {
  private readonly SKILL_VERSION = 'ccli-skill-v1'
  private readonly SKILL_RELATIVE_PATH = join('.claude', 'commands', 'ccli.md')
  private readonly GITIGNORE_ENTRY = '.claude/commands/ccli.md'
  private readonly skillTemplate: string

  constructor() {
    this.skillTemplate = this.loadTemplate()
  }

  /**
   * Install or update the skill file in a project directory.
   * Idempotent: skips if the current version is already installed.
   */
  async installOrUpdate(projectPath: string): Promise<void> {
    try {
      if (!existsSync(projectPath)) {
        console.log(`[SkillInstaller] Project path does not exist, skipping: ${projectPath}`)
        return
      }

      const skillPath = join(projectPath, this.SKILL_RELATIVE_PATH)
      const currentVersion = this.readCurrentVersion(skillPath)

      if (currentVersion === this.SKILL_VERSION) {
        return // Already up to date
      }

      // Create .claude/commands/ directory if needed
      const commandsDir = join(projectPath, '.claude', 'commands')
      if (!existsSync(commandsDir)) {
        mkdirSync(commandsDir, { recursive: true })
      }

      writeFileSync(skillPath, this.skillTemplate, 'utf-8')
      console.log(`[SkillInstaller] ${currentVersion ? 'Updated' : 'Installed'} skill in ${projectPath}`)

      this.ensureGitignore(projectPath)
    } catch (e) {
      console.error(`[SkillInstaller] Failed to install skill in ${projectPath}:`, e)
    }
  }

  /**
   * Read the version comment from the first line of the skill file.
   * Returns null if the file doesn't exist or has no version comment.
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
   * Ensure .claude/commands/ccli.md is listed in .gitignore.
   */
  private ensureGitignore(projectPath: string): void {
    const gitignorePath = join(projectPath, '.gitignore')

    let content = ''
    if (existsSync(gitignorePath)) {
      try {
        content = readFileSync(gitignorePath, 'utf-8')
      } catch {
        return // Can't read, don't modify
      }
    }

    // Check if the entry already exists (line by line to avoid partial matches)
    const lines = content.split('\n').map(l => l.trim())
    if (lines.includes(this.GITIGNORE_ENTRY)) {
      return
    }

    // Append the entry, ensuring there's a newline before it
    const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
    const newContent = content + suffix + this.GITIGNORE_ENTRY + '\n'

    try {
      writeFileSync(gitignorePath, newContent, 'utf-8')
      console.log(`[SkillInstaller] Added ${this.GITIGNORE_ENTRY} to .gitignore in ${projectPath}`)
    } catch (e) {
      console.error(`[SkillInstaller] Failed to update .gitignore in ${projectPath}:`, e)
    }
  }

  /**
   * Load the skill template. Embedded as a string constant for simplicity —
   * avoids file-loading complexity across dev/prod environments.
   */
  private loadTemplate(): string {
    // Read from the template file at module load time
    // In dev: relative to this source file
    // In prod: the file is bundled in dist-electron
    try {
      const templatePath = join(__dirname, '..', 'templates', 'ccli-skill.md')
      if (existsSync(templatePath)) {
        return readFileSync(templatePath, 'utf-8')
      }
    } catch {
      // Fall through to embedded template
    }

    // Fallback: embedded template (ensures it always works even if file is missing)
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
