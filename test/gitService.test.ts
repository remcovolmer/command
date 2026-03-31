import { describe, test, expect } from 'vitest'
import { GitService } from '../electron/main/services/GitService'

// Access private parseStatusV2Output via bracket notation for testing
function parseOutput(output: string) {
  const service = new (GitService as any)()
  return service.parseStatusV2Output(output)
}

// Helper to build NUL-delimited output
function nul(...parts: string[]) {
  return parts.join('\0')
}

describe('parseStatusV2Output', () => {
  test('parses ordinary modified file', () => {
    const output = nul(
      '1 .M N... 100644 100644 100644 abc1234 def5678 src/file.ts',
      ''
    )
    const result = parseOutput(output)
    expect(result.modified).toEqual([
      { path: 'src/file.ts', status: 'modified', staged: false },
    ])
    expect(result.staged).toEqual([])
  })

  test('parses staged added file', () => {
    const output = nul(
      '1 A. N... 000000 100644 100644 0000000 abc1234 new-file.ts',
      ''
    )
    const result = parseOutput(output)
    expect(result.staged).toEqual([
      { path: 'new-file.ts', status: 'added', staged: true },
    ])
    expect(result.modified).toEqual([])
  })

  test('parses renamed file with origPath consumed', () => {
    // Type 2: new path is field 9+ of the entry, origPath is next NUL part
    const output = nul(
      '2 R. N... 100644 100644 100644 abc1234 def5678 R100 new.ts',
      'old.ts',
      ''
    )
    const result = parseOutput(output)
    expect(result.staged).toEqual([
      { path: 'new.ts', status: 'renamed', staged: true },
    ])
  })

  test('parses unmerged/conflicted file', () => {
    const output = nul(
      'u UU N... 100644 100644 100644 100644 abc1234 def5678 ghi9012 conflicted.ts',
      ''
    )
    const result = parseOutput(output)
    expect(result.conflicted).toEqual([
      { path: 'conflicted.ts', status: 'modified', staged: false },
    ])
  })

  test('parses file path with spaces', () => {
    const output = nul(
      '1 .M N... 100644 100644 100644 abc1234 def5678 path/to my/file name.ts',
      ''
    )
    const result = parseOutput(output)
    expect(result.modified).toEqual([
      { path: 'path/to my/file name.ts', status: 'modified', staged: false },
    ])
  })

  test('parses untracked file', () => {
    const output = nul('? untracked.ts', '')
    const result = parseOutput(output)
    expect(result.untracked).toEqual([
      { path: 'untracked.ts', status: 'added', staged: false },
    ])
  })

  test('parses mixed entry types without consuming adjacent entries', () => {
    const output = nul(
      '# branch.head main',
      '1 .M N... 100644 100644 100644 abc1234 def5678 modified.ts',
      '1 A. N... 000000 100644 100644 0000000 abc1234 staged.ts',
      '2 R. N... 100644 100644 100644 abc1234 def5678 R100 renamed.ts',
      'original.ts',
      '? untracked.ts',
      ''
    )
    const result = parseOutput(output)

    expect(result.branch?.name).toBe('main')
    expect(result.modified).toEqual([
      { path: 'modified.ts', status: 'modified', staged: false },
    ])
    expect(result.staged).toEqual([
      { path: 'staged.ts', status: 'added', staged: true },
      { path: 'renamed.ts', status: 'renamed', staged: true },
    ])
    expect(result.untracked).toEqual([
      { path: 'untracked.ts', status: 'added', staged: false },
    ])
  })

  test('handles empty output', () => {
    const result = parseOutput('')
    expect(result.branch).toBeNull()
    expect(result.staged).toEqual([])
    expect(result.modified).toEqual([])
    expect(result.untracked).toEqual([])
    expect(result.conflicted).toEqual([])
  })

  test('parses branch with upstream and ahead/behind', () => {
    const output = nul(
      '# branch.head feature/test',
      '# branch.upstream origin/feature/test',
      '# branch.ab +3 -1',
      ''
    )
    const result = parseOutput(output)
    expect(result.branch).toEqual({
      name: 'feature/test',
      upstream: 'origin/feature/test',
      ahead: 3,
      behind: 1,
    })
  })
})
