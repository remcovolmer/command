import { $prose } from '@milkdown/utils'
import { Plugin } from '@milkdown/prose/state'

/** Returns true if the click should toggle a task checkbox, and dispatches the transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleTaskCheckboxClick(view: any, pos: number, event: MouseEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const li = target.closest('li[data-item-type="task"]')
  if (!li) return false

  // Only toggle when clicking in the checkbox area (the padding-left region where ::before lives)
  const liRect = li.getBoundingClientRect()
  const clickX = event.clientX
  const paddingLeft = parseFloat(getComputedStyle(li).paddingLeft)
  if (clickX > liRect.left + paddingLeft) return false

  const $pos = view.state.doc.resolve(pos)
  // Walk up to find the list_item node
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'list_item' && node.attrs.checked != null) {
      const tr = view.state.tr.setNodeMarkup($pos.before(d), undefined, {
        ...node.attrs,
        checked: !node.attrs.checked,
      })
      view.dispatch(tr)
      return true
    }
  }
  return false
}

export const taskCheckboxToggle = $prose(() => {
  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        return handleTaskCheckboxClick(view, pos, event)
      },
    },
  })
})
