import { describe, test, expect } from 'vitest'
import { needsSync, computeDirty, decideExternalReload } from '../src/utils/editorReconcile'

describe('needsSync', () => {
  test('false when the pane already holds the canonical content (no rebuild → scroll preserved)', () => {
    expect(needsSync('# Title\n\nbody', '# Title\n\nbody')).toBe(false)
  })

  test('true when canonical moved on since the pane last held it', () => {
    // e.g. a heading typed in the raw pane that the preview pane has not seen yet
    expect(needsSync('# New heading\n\nbody', 'body')).toBe(true)
  })

  test('empty-vs-empty does not trigger a sync', () => {
    expect(needsSync('', '')).toBe(false)
  })
})

describe('computeDirty', () => {
  test('false when current matches what is on disk', () => {
    expect(computeDirty('saved', 'saved')).toBe(false)
  })

  test('true when current diverges from disk', () => {
    expect(computeDirty('edited', 'saved')).toBe(true)
  })

  test('empty-vs-empty is clean', () => {
    expect(computeDirty('', '')).toBe(false)
  })
})

describe('decideExternalReload', () => {
  test('skip-echo: disk equals our last save within the watcher window', () => {
    expect(decideExternalReload({
      diskText: 'x', savedContent: 'x', isDirty: false, msSinceSelfWrite: 200,
    })).toBe('skip-echo')
  })

  test('apply: disk equals last save but the self-write window has elapsed', () => {
    // No longer attributable to our own save → a genuine no-op refresh, not an echo.
    expect(decideExternalReload({
      diskText: 'x', savedContent: 'x', isDirty: false, msSinceSelfWrite: 5000,
    })).toBe('apply')
  })

  test('skip-dirty: buffer has unsaved edits and disk diverged from last save', () => {
    expect(decideExternalReload({
      diskText: 'external', savedContent: 'saved', isDirty: true, msSinceSelfWrite: 5000,
    })).toBe('skip-dirty')
  })

  test('apply: clean buffer with a genuine external change', () => {
    expect(decideExternalReload({
      diskText: 'external', savedContent: 'saved', isDirty: false, msSinceSelfWrite: 5000,
    })).toBe('apply')
  })

  test('echo suppression wins over the dirty guard when disk matches our save', () => {
    // Disk matches what we just wrote → it is our own echo even if still dirty-flagged.
    expect(decideExternalReload({
      diskText: 'saved', savedContent: 'saved', isDirty: true, msSinceSelfWrite: 200,
    })).toBe('skip-echo')
  })
})
