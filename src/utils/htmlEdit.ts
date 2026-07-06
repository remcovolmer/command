import { parse } from 'parse5'
import type { DirectEditResult } from './annotationMessage'

// Minimal structural view of the parse5 default tree — we only read tagName,
// childNodes, and source offsets, so we avoid parse5's generic tree-adapter
// types (and the `any` they'd otherwise pull in).
interface P5Location {
  startTag?: { endOffset: number } | null
  endTag?: { startOffset: number } | null
}
interface P5Node {
  tagName?: string
  childNodes?: P5Node[]
  sourceCodeLocation?: P5Location | null
}

const elementChildren = (node: P5Node): P5Node[] =>
  (node.childNodes ?? []).filter((c): c is P5Node => typeof c.tagName === 'string')

/**
 * Edit a local HTML file by structurally locating the edited element and
 * splicing only its inner source range — the rest of the file stays
 * byte-for-byte identical (unlike reserializing the whole parsed DOM).
 *
 * `indexPath` is the element-child index chain from <html> down to the target
 * (computed in the guest; the browser and parse5 build the same implied tree —
 * both insert <head>, <tbody>, etc. — so the indices line up for static HTML).
 * `tag` guards against structural drift; `newInnerHtml` is the post-edit
 * innerHTML. Returns not-found (caller falls back) when the path doesn't
 * resolve, the tag disagrees, or the element has no editable inner range.
 */
export function applyDomEdit(
  source: string,
  indexPath: number[],
  tag: string,
  newInnerHtml: string
): DirectEditResult {
  let doc: P5Node
  try {
    doc = parse(source, { sourceCodeLocationInfo: true }) as unknown as P5Node
  } catch {
    return { ok: false, reason: 'not-found' }
  }

  let current = elementChildren(doc)[0] // <html>
  if (!current) return { ok: false, reason: 'not-found' }
  for (const idx of indexPath) {
    const kids = elementChildren(current)
    if (idx < 0 || idx >= kids.length) return { ok: false, reason: 'not-found' }
    current = kids[idx]
  }

  if (tag && current.tagName !== tag) return { ok: false, reason: 'not-found' }

  const loc = current.sourceCodeLocation
  const start = loc?.startTag?.endOffset
  const end = loc?.endTag?.startOffset
  // No endTag means a void/self-closing element — nothing to edit inside.
  if (typeof start !== 'number' || typeof end !== 'number' || start > end) {
    return { ok: false, reason: 'not-found' }
  }

  return { ok: true, content: source.slice(0, start) + newInnerHtml + source.slice(end) }
}
