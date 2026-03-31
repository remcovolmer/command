// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleTaskCheckboxClick } from '../src/components/Editor/MarkdownEditor'

// --- Pure mock helpers (no DOM environment needed) ---

function makeNode(typeName: string, attrs: Record<string, unknown> = {}) {
  return { type: { name: typeName }, attrs }
}

function makeView(nodes: ReturnType<typeof makeNode>[], depth: number) {
  const dispatch = vi.fn()
  const setNodeMarkup = vi.fn().mockReturnThis()
  const before = vi.fn((d: number) => d * 10)

  const $pos = {
    depth,
    node: (d: number) => nodes[d] ?? makeNode('doc'),
    before,
  }

  return {
    view: {
      state: {
        doc: { resolve: vi.fn(() => $pos) },
        tr: { setNodeMarkup },
      },
      dispatch,
    },
    dispatch,
    setNodeMarkup,
  }
}

/** Build a mock event + target that satisfies handleTaskCheckboxClick's DOM checks. */
function makeClickEvent(opts: {
  isHTMLElement?: boolean
  isTaskItem?: boolean
  liLeft?: number
  paddingLeft?: string
  clientX?: number
}) {
  const {
    isHTMLElement = true,
    isTaskItem = true,
    liLeft = 100,
    paddingLeft = '24px',
    clientX = 110,
  } = opts

  // Mock the <li> element returned by closest()
  const li = {
    getBoundingClientRect: () => ({
      left: liLeft, top: 0, right: 300, bottom: 20, width: 200, height: 20,
    }),
  }

  // Mock target: either an HTMLElement-like or a plain object
  let target: unknown
  if (isHTMLElement) {
    target = {
      closest: vi.fn((selector: string) => {
        if (selector === 'li[data-item-type="task"]' && isTaskItem) return li
        return null
      }),
    }
    // Make instanceof HTMLElement work by setting constructor chain
    Object.setPrototypeOf(target, HTMLElement.prototype)
  } else {
    target = { nodeType: 3 } // Text node mock — not an HTMLElement
  }

  const event = { target, clientX } as unknown as MouseEvent

  return { event, li }
}

// Mock getComputedStyle globally
let computedPaddingLeft = '24px'
const originalGetComputedStyle = globalThis.getComputedStyle

beforeEach(() => {
  globalThis.getComputedStyle = vi.fn(() => ({
    paddingLeft: computedPaddingLeft,
  })) as unknown as typeof getComputedStyle
})

afterEach(() => {
  globalThis.getComputedStyle = originalGetComputedStyle
  computedPaddingLeft = '24px'
})

// --- Tests ---

describe('handleTaskCheckboxClick', () => {
  test('returns false when target is not an HTMLElement', () => {
    const { event } = makeClickEvent({ isHTMLElement: false })
    const { view } = makeView([], 0)
    expect(handleTaskCheckboxClick(view, 0, event)).toBe(false)
  })

  test('returns false when click is not inside a task list item', () => {
    const { event } = makeClickEvent({ isTaskItem: false })
    const { view } = makeView([], 0)
    expect(handleTaskCheckboxClick(view, 0, event)).toBe(false)
  })

  test('returns false when click is outside checkbox area (beyond padding-left)', () => {
    // li starts at 100, padding is 24px, click at 130 → 30px from left → beyond 24px
    const { event } = makeClickEvent({ liLeft: 100, paddingLeft: '24px', clientX: 130 })
    computedPaddingLeft = '24px'
    const { view } = makeView([], 0)
    expect(handleTaskCheckboxClick(view, 0, event)).toBe(false)
  })

  test('returns false when click is exactly at boundary', () => {
    // li starts at 100, padding 24px → boundary at 124, click at 125 → beyond
    const { event } = makeClickEvent({ liLeft: 100, paddingLeft: '24px', clientX: 125 })
    computedPaddingLeft = '24px'
    const { view } = makeView([], 0)
    expect(handleTaskCheckboxClick(view, 0, event)).toBe(false)
  })

  test('toggles checked=false to true when clicking in checkbox area', () => {
    const { event } = makeClickEvent({ liLeft: 100, clientX: 110 })
    computedPaddingLeft = '24px'

    const nodes = [
      makeNode('doc'),
      makeNode('bullet_list'),
      makeNode('list_item', { checked: false, label: 'task' }),
    ]
    const { view, dispatch, setNodeMarkup } = makeView(nodes, 2)

    expect(handleTaskCheckboxClick(view, 5, event)).toBe(true)
    expect(setNodeMarkup).toHaveBeenCalledWith(
      expect.any(Number),
      undefined,
      { checked: true, label: 'task' },
    )
    expect(dispatch).toHaveBeenCalled()
  })

  test('toggles checked=true to false when clicking in checkbox area', () => {
    const { event } = makeClickEvent({ liLeft: 100, clientX: 105 })
    computedPaddingLeft = '24px'

    const nodes = [
      makeNode('doc'),
      makeNode('bullet_list'),
      makeNode('list_item', { checked: true }),
    ]
    const { view, dispatch, setNodeMarkup } = makeView(nodes, 2)

    expect(handleTaskCheckboxClick(view, 5, event)).toBe(true)
    expect(setNodeMarkup).toHaveBeenCalledWith(
      expect.any(Number),
      undefined,
      { checked: false },
    )
    expect(dispatch).toHaveBeenCalled()
  })

  test('returns false when no list_item ancestor has checked attribute', () => {
    const { event } = makeClickEvent({ liLeft: 100, clientX: 110 })
    computedPaddingLeft = '24px'

    const nodes = [
      makeNode('doc'),
      makeNode('bullet_list'),
      makeNode('list_item', {}), // no checked attr
    ]
    const { view, dispatch } = makeView(nodes, 2)

    expect(handleTaskCheckboxClick(view, 5, event)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })

  test('click boundary adapts to different padding-left values', () => {
    // Small padding 16px: click at 117 → 17px from left → beyond 16px → rejected
    computedPaddingLeft = '16px'
    const { event: event1 } = makeClickEvent({ liLeft: 100, clientX: 117 })
    const nodes = [makeNode('doc'), makeNode('list_item', { checked: false })]
    const { view: view1 } = makeView(nodes, 1)
    expect(handleTaskCheckboxClick(view1, 0, event1)).toBe(false)

    // Large padding 40px: click at 135 → 35px from left → within 40px → accepted
    computedPaddingLeft = '40px'
    const { event: event2 } = makeClickEvent({ liLeft: 100, clientX: 135 })
    const { view: view2, dispatch } = makeView(nodes, 1)
    expect(handleTaskCheckboxClick(view2, 0, event2)).toBe(true)
    expect(dispatch).toHaveBeenCalled()
  })

  test('click on child element delegates to parent task li via closest()', () => {
    // The target.closest() mock handles this — it returns the li regardless of nesting
    const { event } = makeClickEvent({ liLeft: 100, clientX: 110 })
    computedPaddingLeft = '24px'

    const nodes = [makeNode('doc'), makeNode('list_item', { checked: false })]
    const { view, dispatch } = makeView(nodes, 1)

    expect(handleTaskCheckboxClick(view, 0, event)).toBe(true)
    expect(dispatch).toHaveBeenCalled()
  })
})
