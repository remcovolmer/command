// @vitest-environment jsdom

import { describe, test, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NotchStrip } from '@/components/Notch/NotchStrip'

afterEach(cleanup)

describe('NotchStrip', () => {
  test('renders the strip container', () => {
    render(<NotchStrip />)
    // getByTestId throws if the element is absent, so a truthy assertion is enough.
    expect(screen.getByTestId('notch-strip')).toBeTruthy()
  })
})
