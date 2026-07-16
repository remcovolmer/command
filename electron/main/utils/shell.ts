// Pure shell-spawn derivation, extracted from TerminalManager so it can be
// unit-tested without electron / node-pty. Given a resolved shell path and the
// host platform, decide the spawn args and any env the shell needs.

export interface ShellSpec {
  /** The shell executable to spawn. */
  shell: string
  /** Args passed to pty.spawn (empty for shells that need none). */
  args: string[]
  /** Extra env vars to merge into the spawn environment (empty when none). */
  env: Record<string, string>
}

/**
 * Derive the spawn args and env for a resolved shell path.
 *
 * Git Bash on Windows must start as a login shell (`--login -i`) so that
 * /etc/profile populates PATH with /usr/bin — the MSYS coreutils dir holding
 * sed, dirname, uname, etc. A non-login bash inherits only the Windows PATH,
 * which lacks those tools, so the sh-style npm CLI shims (vercel, and any other
 * global that ships a POSIX wrapper) fail with MODULE_NOT_FOUND. A login shell's
 * /etc/profile would otherwise cd to $HOME and discard the spawn cwd, so
 * CHERE_INVOKING is set to keep the invocation directory.
 *
 * Non-Windows shells (and PowerShell/cmd) keep their previous behaviour of no
 * extra args and no extra env.
 *
 * The Windows-bash match is intentionally broad: it also applies to a bash
 * supplied via the COMMAND_CENTER_SHELL override, where login args are likewise
 * the desired behaviour. CHERE_INVOKING is a Git-for-Windows convention that any
 * non-MSYS bash (e.g. WSL) simply ignores.
 */
export function deriveShellSpec(shell: string, platform: NodeJS.Platform): ShellSpec {
  const isWindowsGitBash = platform === 'win32' && /bash(\.exe)?$/i.test(shell)
  if (isWindowsGitBash) {
    return { shell, args: ['--login', '-i'], env: { CHERE_INVOKING: '1' } }
  }
  return { shell, args: [], env: {} }
}

/**
 * Quote an arbitrary prompt as a single shell argument, so it can be appended
 * to a `claude` command line written to the PTY. Interactive `claude "<prompt>"`
 * starts a session with the prompt already submitted — which is how an
 * automation foreground-launches without any PTY-timing injection.
 *
 * Shell-aware because the terminal may run a POSIX shell (Git Bash / bash / zsh:
 * wrap in single quotes, escape embedded single quotes as '\'') or PowerShell
 * (single-quoted literal where only the quote char is escaped, by doubling).
 * Single quoting is used specifically so `$`, backticks, and other metacharacters
 * in the prompt are never expanded.
 */
export function quotePromptForShell(prompt: string, shell: string): string {
  const isPowerShell = /powershell|pwsh/i.test(shell)
  if (isPowerShell) {
    return `'${prompt.replace(/'/g, "''")}'`
  }
  return `'${prompt.replace(/'/g, "'\\''")}'`
}
