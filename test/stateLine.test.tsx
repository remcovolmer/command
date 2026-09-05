// @vitest-environment jsdom

import { describe, test, expect, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { StateLine, stateLineClass } from '../src/components/Terminal/StateLine'

afterEach(() => cleanup())

describe('stateLineClass', () => {
  test('busy: no static class — the sweep gradient is applied as inline style', () => {
    expect(stateLineClass('busy')).toBe('')
  })

  test('permission and question: amber attention classes', () => {
    expect(stateLineClass('permission')).toBe('bg-status-attention attention-pulse')
    expect(stateLineClass('question')).toBe('bg-status-attention attention-pulse')
  })

  test('done: static green, no pulse', () => {
    expect(stateLineClass('done')).toBe('bg-status-done')
  })

  test('stopped: static red, no pulse', () => {
    expect(stateLineClass('stopped')).toBe('bg-status-stopped')
  })

  test('null: transparent', () => {
    expect(stateLineClass(null)).toBe('bg-transparent')
  })
})

describe('StateLine', () => {
  test('busy renders a static faint line: no animation, no status class', () => {
    const { container } = render(<StateLine state="busy" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).not.toContain('bg-status')
    expect(el.style.animation).toBe('')
    expect(el.style.background).toContain('status-busy')
  })

  test('permission renders the attention-pulse class with no inline animation', () => {
    const { container } = render(<StateLine state="permission" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('bg-status-attention')
    expect(el.className).toContain('attention-pulse')
    expect(el.style.animation).toBe('')
  })

  test('done renders a static class with no animation', () => {
    const { container } = render(<StateLine state="done" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('bg-status-done')
    expect(el.style.animation).toBe('')
  })

  test('stopped renders a static class with no animation', () => {
    const { container } = render(<StateLine state="stopped" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('bg-status-stopped')
  })

  test('null state is transparent', () => {
    const { container } = render(<StateLine state={null} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.className).toContain('bg-transparent')
  })

  test('is aria-hidden (decorative)', () => {
    const { container } = render(<StateLine state="done" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute('aria-hidden')).toBe('true')
  })
})
