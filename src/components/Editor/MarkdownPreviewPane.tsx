import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { history } from '@milkdown/plugin-history'
import { clipboard } from '@milkdown/plugin-clipboard'
import { indent } from '@milkdown/plugin-indent'
import { cursor } from '@milkdown/plugin-cursor'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { getMarkdown, replaceAll } from '@milkdown/utils'
import { taskCheckboxToggle } from './taskCheckbox'

/**
 * Imperative handle the owning container uses to reconcile content on toggle.
 * Replaces the former `window.__milkdownReplace` global, which collided across
 * multiple mounted markdown tabs (last-mount-wins).
 */
export interface MarkdownPreviewHandle {
  /** Replace the editor's whole document with `content`. No-op if not ready. */
  replace: (content: string) => void
  /** Serialize the current document to markdown, or null if not ready. */
  getMarkdown: () => string | null
  /** Whether the underlying editor instance is initialized and usable. */
  isReady: () => boolean
}

interface PreviewInnerProps {
  defaultValue: string
  onMarkdownUpdated: (markdown: string) => void
  onReady?: () => void
}

const PreviewInner = forwardRef<MarkdownPreviewHandle, PreviewInnerProps>(
  function PreviewInner({ defaultValue, onMarkdownUpdated, onReady }, ref) {
    // Keep the latest callbacks in refs so the once-configured listener never
    // calls a stale closure (useEditor only re-runs on defaultValue change).
    const onUpdateRef = useRef(onMarkdownUpdated)
    onUpdateRef.current = onMarkdownUpdated
    const onReadyRef = useRef(onReady)
    onReadyRef.current = onReady

    useEditor((root) => {
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, defaultValue)
        })
        .config((ctx) => {
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onUpdateRef.current(markdown)
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        .use(indent)
        .use(cursor)
        .use(listener)
        .use(taskCheckboxToggle)
    }, [defaultValue])

    const [loading, getEditor] = useInstance()
    const isReady = () => !loading && getEditor() != null

    // Notify the owner once the editor instance is usable, so it can flush any
    // content sync that was requested before the editor finished initializing.
    const firedReadyRef = useRef(false)
    useEffect(() => {
      if (isReady() && !firedReadyRef.current) {
        firedReadyRef.current = true
        onReadyRef.current?.()
      }
    }, [loading, getEditor])

    useImperativeHandle(ref, () => ({
      replace: (content: string) => {
        const editor = getEditor()
        if (editor && !loading) editor.action(replaceAll(content))
      },
      getMarkdown: () => {
        const editor = getEditor()
        if (editor && !loading) return editor.action(getMarkdown())
        return null
      },
      isReady,
    }), [getEditor, loading])

    return (
      <div className="milkdown-wrapper h-full w-full overflow-auto bg-background">
        <Milkdown />
      </div>
    )
  }
)

interface MarkdownPreviewPaneProps {
  defaultValue: string
  onMarkdownUpdated: (markdown: string) => void
  onReady?: () => void
}

/**
 * Milkdown WYSIWYG preview pane. State (content/dirty/save) is owned by the
 * parent MarkdownEditor; this component only renders the editor and exposes an
 * imperative handle for content reconciliation on toggle.
 */
export const MarkdownPreviewPane = forwardRef<MarkdownPreviewHandle, MarkdownPreviewPaneProps>(
  function MarkdownPreviewPane(props, ref) {
    return (
      <MilkdownProvider>
        <PreviewInner {...props} ref={ref} />
      </MilkdownProvider>
    )
  }
)
