// @vitest-environment jsdom

import { describe, test, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AgentBadge } from '../src/components/AgentBadge'
import { AGENT_DISPLAY } from '../shared/agents'

describe('AgentBadge', () => {
  afterEach(() => cleanup())

  test('renders a titled brand mark for each agent', () => {
    for (const [type, display] of Object.entries(AGENT_DISPLAY)) {
      cleanup()
      render(<AgentBadge type={type as 'claude' | 'codex' | 'pi'} />)
      // getByTitle matches both the SVG <title> (claude/codex) and the span title (pi).
      expect(screen.getByTitle(`${display.label} chat`)).toBeTruthy()
    }
  })

  test('every agent renders an inline SVG brand logo', () => {
    for (const type of ['claude', 'codex', 'pi'] as const) {
      cleanup()
      const { container } = render(<AgentBadge type={type} />)
      expect(container.querySelector('svg path')).toBeTruthy()
    }
  })

  test('tints the mark by state (the logo is the status indicator)', () => {
    const { container } = render(<AgentBadge type="claude" state="done" />)
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('var(--status-done)')
  })

  test('renders nothing for a normal shell', () => {
    const { container } = render(<AgentBadge type="normal" />)
    expect(container.firstChild).toBeNull()
  })
})
