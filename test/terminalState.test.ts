import { describe, test, expect } from 'vitest'
import {
  ATTENTION_STATES,
  isAttentionState,
  isInputState,
  isVisibleState,
} from '../src/utils/terminalState'

describe('isAttentionState', () => {
  test('permission and question are attention states', () => {
    expect(isAttentionState('permission')).toBe(true)
    expect(isAttentionState('question')).toBe(true)
  })

  test('done, busy and stopped are not attention states', () => {
    expect(isAttentionState('done')).toBe(false)
    expect(isAttentionState('busy')).toBe(false)
    expect(isAttentionState('stopped')).toBe(false)
  })

  test('ATTENTION_STATES contains exactly permission and question', () => {
    expect(ATTENTION_STATES).toEqual(['permission', 'question'])
  })
})

describe('existing state predicates (regression)', () => {
  test('isInputState("done") remains true — contract unchanged by isAttentionState', () => {
    expect(isInputState('done')).toBe(true)
  })

  test('isVisibleState("stopped") remains false', () => {
    expect(isVisibleState('stopped')).toBe(false)
  })
})
