import { describe, test, expect } from 'vitest'
import { deriveShellSpec, quotePromptForShell } from '../electron/main/utils/shell'

describe('deriveShellSpec', () => {
  test('Windows Git Bash (bin/bash.exe) starts as a login shell with CHERE_INVOKING', () => {
    const spec = deriveShellSpec('C:\\Program Files\\Git\\bin\\bash.exe', 'win32')
    expect(spec.args).toEqual(['--login', '-i'])
    expect(spec.env).toEqual({ CHERE_INVOKING: '1' })
  })

  test('Windows scoop Git Bash path also gets login args', () => {
    const spec = deriveShellSpec('C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe', 'win32')
    expect(spec.args).toEqual(['--login', '-i'])
    expect(spec.env.CHERE_INVOKING).toBe('1')
  })

  test('Windows bash without .exe suffix still matches', () => {
    const spec = deriveShellSpec('/usr/bin/bash', 'win32')
    expect(spec.args).toEqual(['--login', '-i'])
    expect(spec.env).toEqual({ CHERE_INVOKING: '1' })
  })

  test('Windows PowerShell gets no extra args or env', () => {
    const spec = deriveShellSpec('powershell.exe', 'win32')
    expect(spec.args).toEqual([])
    expect(spec.env).toEqual({})
  })

  test('Windows cmd.exe gets no extra args or env', () => {
    const spec = deriveShellSpec('cmd.exe', 'win32')
    expect(spec.args).toEqual([])
    expect(spec.env).toEqual({})
  })

  test('Linux /bin/bash gets no login args (login behaviour is Windows-only)', () => {
    const spec = deriveShellSpec('/bin/bash', 'linux')
    expect(spec.args).toEqual([])
    expect(spec.env).toEqual({})
  })

  test('macOS /bin/zsh gets no extra args or env', () => {
    const spec = deriveShellSpec('/bin/zsh', 'darwin')
    expect(spec.args).toEqual([])
    expect(spec.env).toEqual({})
  })

  test('a Git Bash supplied via COMMAND_CENTER_SHELL override also gets login args', () => {
    // The override feeds its value straight through getShell into deriveShellSpec;
    // a bash override is treated like auto-detected Git Bash on Windows.
    const spec = deriveShellSpec('D:\\custom\\git\\bin\\bash.exe', 'win32')
    expect(spec.args).toEqual(['--login', '-i'])
  })

  test('the returned shell path is passed through unchanged', () => {
    const shell = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(deriveShellSpec(shell, 'win32').shell).toBe(shell)
    expect(deriveShellSpec('powershell.exe', 'win32').shell).toBe('powershell.exe')
  })

  test('env is a fresh object per call (no shared mutable reference)', () => {
    const a = deriveShellSpec('C:\\Program Files\\Git\\bin\\bash.exe', 'win32')
    const b = deriveShellSpec('C:\\Program Files\\Git\\bin\\bash.exe', 'win32')
    expect(a.env).not.toBe(b.env)
  })
})

describe('quotePromptForShell', () => {
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const pwsh = 'powershell.exe'

  test('wraps a plain prompt in single quotes (POSIX)', () => {
    expect(quotePromptForShell('review the open PRs', bash)).toBe("'review the open PRs'")
  })

  test('POSIX: escapes embedded single quotes as \\047\\134\\047\\047', () => {
    // it's → 'it'\''s'
    expect(quotePromptForShell("it's broken", bash)).toBe("'it'\\''s broken'")
  })

  test('POSIX: leaves $, backticks, and double quotes untouched inside single quotes', () => {
    const prompt = 'run `git log` for $USER and say "hi"'
    expect(quotePromptForShell(prompt, bash)).toBe(
      "'run `git log` for $USER and say \"hi\"'"
    )
  })

  test('POSIX: preserves embedded newlines literally', () => {
    expect(quotePromptForShell('line one\nline two', bash)).toBe("'line one\nline two'")
  })

  test('PowerShell: single-quoted literal, doubling embedded single quotes', () => {
    expect(quotePromptForShell("it's broken", pwsh)).toBe("'it''s broken'")
  })

  test('PowerShell: metacharacters stay literal inside single quotes', () => {
    expect(quotePromptForShell('cost is $5 `now`', pwsh)).toBe("'cost is $5 `now`'")
  })
})
