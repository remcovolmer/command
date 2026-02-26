import { describe, test, expect } from 'vitest'

/**
 * Pure extraction of the template replacement logic from AutomationService.triggerRun().
 * This mirrors the exact regex and sanitization used in production so we can test it
 * without instantiating AutomationService and its heavy dependency graph.
 */

interface PREventContext {
  number: number
  title: string
  branch: string
  url: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  state: 'OPEN' | 'CLOSED' | 'MERGED'
}

function resolvePromptTemplate(
  template: string,
  prContext?: PREventContext
): string {
  const sanitize = (s: string, maxLen = 200): string =>
    s.replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, maxLen)

  const templateVars: Record<string, string> = prContext ? {
    number: String(prContext.number),
    title: sanitize(prContext.title),
    branch: sanitize(prContext.branch),
    url: sanitize(prContext.url, 500),
    mergeable: prContext.mergeable,
    state: prContext.state,
  } : {}

  return template.replace(
    /\{\{pr\.(\w+)\}\}/g,
    (_match, key: string) => (key in templateVars) ? templateVars[key] : ''
  )
}

const fullContext: PREventContext = {
  number: 42,
  title: 'Fix bug in auth flow',
  branch: 'fix/auth-bug',
  url: 'https://github.com/org/repo/pull/42',
  mergeable: 'MERGEABLE',
  state: 'OPEN',
}

describe('resolvePromptTemplate', () => {

  // --- Full context replacement ---

  describe('full context replacement', () => {
    test('replaces all 6 template variables', () => {
      const template =
        'Review PR #{{pr.number}}: {{pr.title}} on branch {{pr.branch}}. ' +
        'URL: {{pr.url}}, mergeable: {{pr.mergeable}}, state: {{pr.state}}'

      const result = resolvePromptTemplate(template, fullContext)

      expect(result).toBe(
        'Review PR #42: Fix bug in auth flow on branch fix/auth-bug. ' +
        'URL: https://github.com/org/repo/pull/42, mergeable: MERGEABLE, state: OPEN'
      )
    })

    test('handles repeated variables', () => {
      const template = '{{pr.number}} and again {{pr.number}}'
      const result = resolvePromptTemplate(template, fullContext)
      expect(result).toBe('42 and again 42')
    })
  })

  // --- No context (manual trigger) ---

  describe('no context (manual trigger)', () => {
    test('strips all template variables to empty strings', () => {
      const template = 'Fix {{pr.title}} on {{pr.branch}}'
      const result = resolvePromptTemplate(template, undefined)
      expect(result).toBe('Fix  on ')
    })

    test('strips all 6 variables when no context provided', () => {
      const template =
        '{{pr.number}} {{pr.title}} {{pr.branch}} {{pr.url}} {{pr.mergeable}} {{pr.state}}'
      const result = resolvePromptTemplate(template, undefined)
      expect(result).toBe('     ')
    })
  })

  // --- Typos in template variables ---

  describe('typos in template variables', () => {
    test('strips unrecognized variable names', () => {
      const result = resolvePromptTemplate('{{pr.titl}}', fullContext)
      expect(result).toBe('')
    })

    test('strips multiple typos while resolving valid vars', () => {
      const template = '{{pr.number}}: {{pr.titl}} on {{pr.brunch}}'
      const result = resolvePromptTemplate(template, fullContext)
      expect(result).toBe('42:  on ')
    })

    test('does not match non-pr namespaced variables', () => {
      // {{env.FOO}} should stay as-is since the regex only matches {{pr.*}}
      const template = '{{env.FOO}} and {{pr.number}}'
      const result = resolvePromptTemplate(template, fullContext)
      expect(result).toBe('{{env.FOO}} and 42')
    })
  })

  // --- Sanitization ---

  describe('sanitization', () => {
    test('replaces newlines and tabs with spaces in title', () => {
      const ctx: PREventContext = {
        ...fullContext,
        title: 'Line1\nLine2\tTabbed\rCarriage',
      }
      const result = resolvePromptTemplate('{{pr.title}}', ctx)
      expect(result).toBe('Line1 Line2 Tabbed Carriage')
    })

    test('strips non-printable ASCII characters', () => {
      const ctx: PREventContext = {
        ...fullContext,
        title: 'Hello\x00World\x01Test\x7F',
      }
      const result = resolvePromptTemplate('{{pr.title}}', ctx)
      expect(result).toBe('HelloWorldTest')
    })

    test('truncates title to 200 characters', () => {
      const ctx: PREventContext = {
        ...fullContext,
        title: 'A'.repeat(300),
      }
      const result = resolvePromptTemplate('{{pr.title}}', ctx)
      expect(result).toHaveLength(200)
      expect(result).toBe('A'.repeat(200))
    })

    test('truncates branch to 200 characters', () => {
      const ctx: PREventContext = {
        ...fullContext,
        branch: 'feature/' + 'x'.repeat(300),
      }
      const result = resolvePromptTemplate('{{pr.branch}}', ctx)
      expect(result).toHaveLength(200)
    })

    test('truncates url to 500 characters', () => {
      const ctx: PREventContext = {
        ...fullContext,
        url: 'https://github.com/' + 'x'.repeat(600),
      }
      const result = resolvePromptTemplate('{{pr.url}}', ctx)
      expect(result).toHaveLength(500)
    })

    test('sanitizes branch with newlines', () => {
      const ctx: PREventContext = {
        ...fullContext,
        branch: 'feature/\ninjection',
      }
      const result = resolvePromptTemplate('{{pr.branch}}', ctx)
      expect(result).toBe('feature/ injection')
      expect(result).not.toContain('\n')
    })
  })

  // --- No template variables ---

  describe('no template variables', () => {
    test('returns prompt unchanged when no variables present', () => {
      const template = 'Just a plain prompt with no variables.'
      expect(resolvePromptTemplate(template, fullContext)).toBe(template)
      expect(resolvePromptTemplate(template, undefined)).toBe(template)
    })

    test('returns empty string unchanged', () => {
      expect(resolvePromptTemplate('', fullContext)).toBe('')
    })
  })

  // --- Edge cases ---

  describe('edge cases', () => {
    test('number is stringified correctly', () => {
      const result = resolvePromptTemplate('PR #{{pr.number}}', fullContext)
      expect(result).toBe('PR #42')
    })

    test('mergeable and state are passed through without sanitization', () => {
      const ctx: PREventContext = {
        ...fullContext,
        mergeable: 'CONFLICTING',
        state: 'MERGED',
      }
      const result = resolvePromptTemplate(
        '{{pr.mergeable}} {{pr.state}}',
        ctx
      )
      expect(result).toBe('CONFLICTING MERGED')
    })

    test('adjacent template variables resolve correctly', () => {
      const result = resolvePromptTemplate(
        '{{pr.number}}{{pr.title}}',
        fullContext
      )
      expect(result).toBe('42Fix bug in auth flow')
    })

    test('malformed double braces are ignored', () => {
      // Missing closing braces, extra braces, etc.
      const template = '{{pr.number} {pr.title}} {{ pr.branch }}'
      const result = resolvePromptTemplate(template, fullContext)
      // None of these match the {{pr.key}} pattern
      expect(result).toBe('{{pr.number} {pr.title}} {{ pr.branch }}')
    })
  })
})
