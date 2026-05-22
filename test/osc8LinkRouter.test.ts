import { describe, test, expect } from 'vitest'
import { classifyOsc8Uri } from '../src/utils/osc8LinkRouter'

const base = 'C:/projects/p'

describe('classifyOsc8Uri — editor (happy path)', () => {
  test('routes .md relative path to editor', () => {
    const decision = classifyOsc8Uri('docs/foo.md', base)
    expect(decision).toEqual({
      kind: 'editor',
      resolved: 'C:/projects/p/docs/foo.md',
      fileName: 'foo.md',
    })
  })

  test('routes .html relative path to editor', () => {
    const decision = classifyOsc8Uri('public/index.html', base)
    expect(decision).toEqual({
      kind: 'editor',
      resolved: 'C:/projects/p/public/index.html',
      fileName: 'index.html',
    })
  })

  test('routes .htm relative path to editor', () => {
    const decision = classifyOsc8Uri('public/index.htm', base)
    expect(decision).toEqual({
      kind: 'editor',
      resolved: 'C:/projects/p/public/index.htm',
      fileName: 'index.htm',
    })
  })

  test('accepts mixed-case extension', () => {
    const decision = classifyOsc8Uri('Foo.HTML', base)
    expect(decision.kind).toBe('editor')
    if (decision.kind === 'editor') {
      expect(decision.fileName).toBe('Foo.HTML')
    }
  })

  test('derives filename from deeply nested path', () => {
    const decision = classifyOsc8Uri('a/b/c/x.md', base)
    expect(decision.kind).toBe('editor')
    if (decision.kind === 'editor') {
      expect(decision.fileName).toBe('x.md')
    }
  })

  test('strips trailing slash from base path before joining', () => {
    const decision = classifyOsc8Uri('docs/foo.md', 'C:/projects/p/')
    expect(decision.kind).toBe('editor')
    if (decision.kind === 'editor') {
      expect(decision.resolved).toBe('C:/projects/p/docs/foo.md')
    }
  })

  test('trims leading/trailing whitespace before classifying', () => {
    const decision = classifyOsc8Uri('  docs/foo.md  ', base)
    expect(decision).toEqual({
      kind: 'editor',
      resolved: 'C:/projects/p/docs/foo.md',
      fileName: 'foo.md',
    })
  })
})

describe('classifyOsc8Uri — external', () => {
  test('routes http URL to external', () => {
    expect(classifyOsc8Uri('http://example.com/x', base)).toEqual({
      kind: 'external',
      url: 'http://example.com/x',
    })
  })

  test('routes https URL to external', () => {
    expect(classifyOsc8Uri('https://claude.ai/code/session_abc', base)).toEqual({
      kind: 'external',
      url: 'https://claude.ai/code/session_abc',
    })
  })

  test('routes mixed-case https scheme to external', () => {
    const decision = classifyOsc8Uri('HTTPS://example.com', base)
    expect(decision.kind).toBe('external')
  })
})

describe('classifyOsc8Uri — ignore (extension)', () => {
  test('ignores non-allowed extension', () => {
    const decision = classifyOsc8Uri('src/foo.ts', base)
    expect(decision.kind).toBe('ignore')
    if (decision.kind === 'ignore') {
      expect(decision.reason).toBeTruthy()
    }
  })

  test('ignores path with no extension', () => {
    expect(classifyOsc8Uri('README', base).kind).toBe('ignore')
  })
})

describe('classifyOsc8Uri — ignore (scheme)', () => {
  test('ignores file:// scheme', () => {
    expect(classifyOsc8Uri('file:///etc/passwd', base).kind).toBe('ignore')
  })

  test('ignores javascript: scheme', () => {
    expect(classifyOsc8Uri('javascript:alert(1)', base).kind).toBe('ignore')
  })

  test('ignores data: scheme', () => {
    expect(classifyOsc8Uri('data:text/html,<script>', base).kind).toBe('ignore')
  })

  test('ignores vscode: scheme', () => {
    expect(classifyOsc8Uri('vscode://foo', base).kind).toBe('ignore')
  })
})

describe('classifyOsc8Uri — ignore (traversal)', () => {
  test('ignores leading parent-directory segment', () => {
    expect(classifyOsc8Uri('../etc/passwd.md', base).kind).toBe('ignore')
  })

  test('ignores mid-path parent-directory segment', () => {
    expect(classifyOsc8Uri('docs/../../etc/passwd.md', base).kind).toBe('ignore')
  })

  test('ignores backslash-separated traversal', () => {
    expect(classifyOsc8Uri('docs\\..\\..\\etc\\passwd.md', base).kind).toBe('ignore')
  })
})

describe('classifyOsc8Uri — ignore (absolute paths)', () => {
  test('ignores absolute Unix path', () => {
    expect(classifyOsc8Uri('/etc/foo.md', base).kind).toBe('ignore')
  })

  test('ignores absolute Windows path with backslashes', () => {
    expect(classifyOsc8Uri('C:\\Users\\foo.md', base).kind).toBe('ignore')
  })

  test('ignores absolute Windows path with forward slashes', () => {
    expect(classifyOsc8Uri('C:/Users/foo.md', base).kind).toBe('ignore')
  })

  test('ignores leading backslash', () => {
    expect(classifyOsc8Uri('\\share\\foo.md', base).kind).toBe('ignore')
  })
})

describe('classifyOsc8Uri — ignore (input shape)', () => {
  test('ignores empty URI', () => {
    expect(classifyOsc8Uri('', base).kind).toBe('ignore')
  })

  test('ignores whitespace-only URI', () => {
    expect(classifyOsc8Uri('   ', base).kind).toBe('ignore')
  })

  test('ignores URI exceeding length limit', () => {
    const oversized = 'a'.repeat(2001) + '.md'
    expect(classifyOsc8Uri(oversized, base).kind).toBe('ignore')
  })

  test('ignores missing base path', () => {
    expect(classifyOsc8Uri('docs/foo.md', '').kind).toBe('ignore')
  })
})
