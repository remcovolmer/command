import { describe, test, expect } from 'vitest'
import { createContextLossPolicy } from '../src/utils/webglRecovery'

describe('createContextLossPolicy', () => {
  test('recovers from an occasional context loss', () => {
    let t = 0
    const policy = createContextLossPolicy({ maxRecoveries: 3, windowMs: 1000, now: () => t })
    expect(policy.shouldRecover()).toBe(true)
    t = 5000
    expect(policy.shouldRecover()).toBe(true)
  })

  test('stops recovering on rapid repeated loss', () => {
    let t = 0
    const policy = createContextLossPolicy({ maxRecoveries: 2, windowMs: 1000, now: () => t })
    expect(policy.shouldRecover()).toBe(true)
    t = 100
    expect(policy.shouldRecover()).toBe(true)
    t = 200
    expect(policy.shouldRecover()).toBe(false)
    t = 300
    expect(policy.shouldRecover()).toBe(false)
  })

  test('allows recovery again once old losses leave the window', () => {
    let t = 0
    const policy = createContextLossPolicy({ maxRecoveries: 1, windowMs: 1000, now: () => t })
    expect(policy.shouldRecover()).toBe(true)
    t = 10
    expect(policy.shouldRecover()).toBe(false)
    t = 2000
    expect(policy.shouldRecover()).toBe(true)
  })
})
