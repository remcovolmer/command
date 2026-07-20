// @vitest-environment jsdom

import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// Bypass persist (no localStorage in this harness) and stub the electron API,
// mirroring projectStore.test.ts — the component reads store state directly.
vi.mock('zustand/middleware', () => ({
  persist: (fn: unknown) => fn,
}))
vi.mock('../src/utils/electron', () => ({
  getElectronAPI: () => ({
    usage: { setEnabled: vi.fn(() => Promise.resolve()), onUpdate: () => () => {} },
  }),
}))

import { UsageIndicator } from '../src/components/Sidebar/UsageIndicator'
import { useProjectStore } from '../src/stores/projectStore'
import type { UsageData, UsageProvider } from '../src/types'

const RESET = '2026-07-27T09:00:00+00:00'

function setUsage(usageData: Partial<Record<UsageProvider, UsageData>>, enabled = true) {
  useProjectStore.setState({ showUsageIndicator: enabled, usageData })
}

describe('UsageIndicator', () => {
  beforeEach(() => setUsage({}))
  afterEach(() => cleanup())

  test('toggled off renders nothing', () => {
    setUsage({ claude: { provider: 'claude', status: 'ok', fiveHour: { utilization: 42, resetsAt: RESET } } }, false)
    const { container } = render(<UsageIndicator />)
    expect(container.firstChild).toBeNull()
  })

  test('empty map (enabled, no data yet) shows one muted placeholder, no provider label', () => {
    setUsage({})
    render(<UsageIndicator />)
    expect(screen.getByText('usage n/a')).toBeTruthy()
    expect(screen.queryByText('Claude')).toBeNull()
    expect(screen.queryByText('Codex')).toBeNull()
  })

  test('single provider renders a bar with no provider label (parity with today)', () => {
    setUsage({ claude: { provider: 'claude', status: 'ok', fiveHour: { utilization: 42, resetsAt: RESET } } })
    const { container } = render(<UsageIndicator />)
    expect(container.textContent).toContain('42%')
    expect(screen.queryByText('Claude')).toBeNull()
  })

  test('two providers render two labeled rows', () => {
    setUsage({
      claude: { provider: 'claude', status: 'ok', fiveHour: { utilization: 42, resetsAt: RESET } },
      codex: { provider: 'codex', status: 'ok', sevenDay: { utilization: 62, resetsAt: RESET, label: 'wk' } },
    })
    render(<UsageIndicator />)
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('Codex')).toBeTruthy()
  })

  test('weekly-only Codex prefixes the percent with its window label', () => {
    setUsage({ codex: { provider: 'codex', status: 'ok', sevenDay: { utilization: 62, resetsAt: RESET, label: 'wk' } } })
    const { container } = render(<UsageIndicator />)
    // Not misread as a 5h figure: rendered window carries its "wk" label.
    expect(container.textContent).toContain('wk 62%')
  })

  test('a weekly limit closest to binding drives the color and shows a hint', () => {
    setUsage({
      codex: {
        provider: 'codex',
        status: 'ok',
        fiveHour: { utilization: 20, resetsAt: RESET, label: '5h' },
        sevenDay: { utilization: 85, resetsAt: RESET, label: 'wk' },
      },
    })
    const { container } = render(<UsageIndicator />)
    expect(container.textContent).toContain('20%') // 5h window is on the bar
    expect(container.textContent).toContain('wk 85%') // weekly drives the warning color
  })

  test('unavailable provider in a two-row footer keeps its label on the placeholder', () => {
    setUsage({
      claude: { provider: 'claude', status: 'ok', fiveHour: { utilization: 42, resetsAt: RESET } },
      codex: { provider: 'codex', status: 'unavailable' },
    })
    render(<UsageIndicator />)
    expect(screen.getByText('Codex')).toBeTruthy()
    expect(screen.getByText('usage n/a')).toBeTruthy()
  })

  test('a provider with no entry renders nothing for it (no placeholder)', () => {
    setUsage({ claude: { provider: 'claude', status: 'ok', fiveHour: { utilization: 42, resetsAt: RESET } } })
    render(<UsageIndicator />)
    // Claude-only: no Codex row, no Codex placeholder.
    expect(screen.queryByText('Codex')).toBeNull()
    expect(screen.queryByText('usage n/a')).toBeNull()
  })
})
