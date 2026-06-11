import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { fileWatcherEvents } from '../../utils/fileWatcherEvents'
import { normalizeFilePath } from '../../utils/paths'
import { needsSync, computeDirty, decideExternalReload } from '../../utils/editorReconcile'
import { MarkdownPreviewPane, type MarkdownPreviewHandle } from './MarkdownPreviewPane'
import type { FileWatchEvent } from '../../types'

// Milkdown's listener debounces `markdownUpdated` by 200ms (lodash debounce in
// @milkdown/plugin-listener), so the change event from a programmatic
// replaceAll() fires asynchronously. We recognize that bounce by BOTH timing
// (within this window of the push) AND value (equals what we pushed), so it is
// dropped while a genuine edit made inside the window — which differs in value —
// still updates the canonical buffer and dirty state. (Monaco's onChange fires
// synchronously on setValue, so the raw pane uses an immediate boolean guard
// instead — see syncingMonacoRef.)
const PREVIEW_BOUNCE_SUPPRESS_MS = 400

interface MarkdownEditorProps {
  tabId: string
  filePath: string
  isActive: boolean
  mode: 'raw' | 'preview'
}

/**
 * State owner for a markdown editor tab. Mounts a Monaco raw pane AND the
 * Milkdown preview pane at the same time (both stay in the DOM; visibility is
 * toggled via CSS) so scroll position and unsaved edits survive a raw/preview
 * switch. The container owns the single content buffer, dirty state, save
 * handler, and file watcher; the two panes are views reconciled on toggle.
 *
 * Mirrors HtmlEditor's lifecycle, but markdown has TWO editable panes, so
 * content reconciles bidirectionally: on activation the canonical content is
 * pushed into the pane that just became visible (only when it actually moved
 * on since that pane last held it, so an unchanged pane keeps its scroll), and
 * the active pane's edits flow back to the canonical buffer.
 */
export function MarkdownEditor({ tabId, filePath, isActive, mode }: MarkdownEditorProps) {
  const api = getElectronAPI()
  const resolvedTheme = useProjectStore((s) => s.resolvedTheme)
  const setEditorDirty = useProjectStore((s) => s.setEditorDirty)
  const setEditorTabDeletedExternally = useProjectStore((s) => s.setEditorTabDeletedExternally)
  const isDeletedExternally = useProjectStore((s) => {
    const tab = s.editorTabs[tabId]
    return tab?.type === 'editor' ? tab.isDeletedExternally ?? false : false
  })
  const projectId = useProjectStore((s) => {
    const tab = s.editorTabs[tabId]
    return tab?.type === 'editor' ? tab.projectId : null
  })

  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const savedContentRef = useRef<string>('')      // last content written to / read from disk
  const currentContentRef = useRef<string>('')    // canonical latest content (live)
  const rawSyncedRef = useRef<string>('')         // content the Monaco pane last held
  const previewSyncedRef = useRef<string>('')     // content the Milkdown pane last held
  const lastDirtyRef = useRef<boolean>(false)
  // Boolean guard for Monaco: setValue fires onChange synchronously, so setting
  // this true→false around the call brackets the resulting event.
  const syncingMonacoRef = useRef<boolean>(false)
  // Time guard for Milkdown: replaceAll's markdownUpdated fires ~200ms later, so
  // we ignore the bounce until this timestamp after a push.
  const suppressPreviewUntilRef = useRef<number>(0)
  // The exact content last pushed into the preview. Combined with the time
  // window, this lets us suppress ONLY the bounce (same value, within window)
  // and never a genuine edit (which differs in value) made in that window.
  const lastPushedToPreviewRef = useRef<string | null>(null)
  const isDeletedRef = useRef(isDeletedExternally)
  isDeletedRef.current = isDeletedExternally
  const readSeqRef = useRef(0)
  // Timestamp of the last local writeFile, used to suppress the chokidar echo.
  const pendingSelfWriteAtRef = useRef<number>(0)

  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const previewRef = useRef<MarkdownPreviewHandle | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  const normalizedPath = useMemo(() => normalizeFilePath(filePath), [filePath])

  const updateDirty = useCallback((value: string) => {
    const dirty = computeDirty(value, savedContentRef.current)
    if (dirty !== lastDirtyRef.current) {
      lastDirtyRef.current = dirty
      setEditorDirty(tabId, dirty)
    }
  }, [tabId, setEditorDirty])

  // Push the canonical content into whichever pane is currently active, but only
  // when that pane has actually fallen behind and is ready. Updating the pane's
  // "last synced" marker only after a real push means a no-op (editor not yet
  // mounted) leaves the marker stale, so a later activation / ready callback
  // retries instead of silently leaving the pane out of date.
  const reconcileActivePane = useCallback(() => {
    const canonical = currentContentRef.current
    if (modeRef.current === 'raw') {
      const ed = monacoRef.current
      if (!ed || !needsSync(canonical, rawSyncedRef.current)) return
      syncingMonacoRef.current = true
      const position = ed.getPosition()
      ed.setValue(canonical)
      if (position) ed.setPosition(position)
      syncingMonacoRef.current = false
      rawSyncedRef.current = canonical
    } else {
      const pv = previewRef.current
      if (!pv || !pv.isReady() || !needsSync(canonical, previewSyncedRef.current)) return
      lastPushedToPreviewRef.current = canonical
      suppressPreviewUntilRef.current = Date.now() + PREVIEW_BOUNCE_SUPPRESS_MS
      pv.replace(canonical)
      previewSyncedRef.current = canonical
    }
  }, [])

  // --- Load file ---
  useEffect(() => {
    let cancelled = false
    setError(null)

    const timeoutId = setTimeout(() => {
      if (!cancelled && content === null) {
        setError('Loading timed out')
      }
    }, 10000)

    api.fs.readFile(filePath)
      .then((text) => {
        clearTimeout(timeoutId)
        if (cancelled) return
        setContent(text)
        savedContentRef.current = text
        currentContentRef.current = text
        rawSyncedRef.current = text
        previewSyncedRef.current = text
      })
      .catch((err) => {
        clearTimeout(timeoutId)
        if (cancelled) return
        setError(err?.message ?? 'Failed to read file')
      })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [filePath, api])

  // Reconcile the active pane whenever the mode changes (or content first loads).
  useEffect(() => {
    if (content === null) return
    reconcileActivePane()
  }, [mode, content, reconcileActivePane])

  // --- File watcher: external edits refresh the active pane; the hidden pane
  // reconciles lazily on its next activation so its scroll isn't reset early. ---
  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    const reloadFile = () => {
      const seq = ++readSeqRef.current
      api.fs.readFile(filePath).then((text) => {
        if (cancelled || seq !== readSeqRef.current) return

        const decision = decideExternalReload({
          diskText: text,
          savedContent: savedContentRef.current,
          isDirty: lastDirtyRef.current,
          msSinceSelfWrite: Date.now() - pendingSelfWriteAtRef.current,
        })
        if (decision === 'skip-echo') return
        if (decision === 'skip-dirty') {
          console.warn('External change to', filePath, 'ignored — buffer has unsaved edits')
          return
        }

        // apply: adopt disk content as canonical and refresh the active pane.
        // The inactive pane's synced marker is left stale so reconcileActivePane
        // pushes into it (and only then) when the user toggles to it.
        savedContentRef.current = text
        currentContentRef.current = text
        lastDirtyRef.current = false
        setEditorDirty(tabId, false)
        setEditorTabDeletedExternally(tabId, false)
        reconcileActivePane()
      }).catch((err) => {
        if (!cancelled) console.error('Failed to reload markdown file:', err)
      })
    }

    const subscriberKey = `markdown-editor-${tabId}`

    const handleWatchEvents = (events: FileWatchEvent[]) => {
      let lastEvent: FileWatchEvent | null = null
      for (const event of events) {
        if (event.path === normalizedPath) {
          lastEvent = event
        }
      }
      if (!lastEvent) return

      if (lastEvent.type === 'file-changed') {
        reloadFile()
      } else if (lastEvent.type === 'file-removed') {
        setEditorTabDeletedExternally(tabId, true)
      } else if (lastEvent.type === 'file-added') {
        if (isDeletedRef.current) {
          setEditorTabDeletedExternally(tabId, false)
          reloadFile()
        }
      }
    }

    fileWatcherEvents.subscribe(projectId, subscriberKey, handleWatchEvents)
    return () => {
      cancelled = true
      fileWatcherEvents.unsubscribe(projectId, subscriberKey)
    }
  }, [projectId, tabId, filePath, normalizedPath, api, reconcileActivePane, setEditorDirty, setEditorTabDeletedExternally])

  const saveFile = useCallback(async () => {
    // Read from the currently-active pane so the very latest keystroke is
    // captured even if its change event hasn't flushed into the canonical ref.
    let value = currentContentRef.current
    if (mode === 'raw') {
      const ed = monacoRef.current
      if (ed) value = ed.getValue()
    } else {
      const md = previewRef.current?.getMarkdown()
      if (md != null) value = md
    }
    try {
      await api.fs.writeFile(filePath, value)
      savedContentRef.current = value
      currentContentRef.current = value
      pendingSelfWriteAtRef.current = Date.now()
      lastDirtyRef.current = false
      setEditorDirty(tabId, false)
      setEditorTabDeletedExternally(tabId, false)
    } catch (err) {
      console.error('Failed to save markdown file:', err)
    }
  }, [api, filePath, tabId, mode, setEditorDirty, setEditorTabDeletedExternally])

  // Save via the global hotkey event and a backup Ctrl+S listener — only the
  // active tab's handler responds, so hidden tabs never save (KTD5).
  useEffect(() => {
    if (!isActive) return
    const handler = () => saveFile()
    window.addEventListener('editor-save-request', handler)
    return () => window.removeEventListener('editor-save-request', handler)
  }, [isActive, saveFile])

  useEffect(() => {
    if (!isActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveFile()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isActive, saveFile])

  const handleRawMount: OnMount = useCallback((monacoEditor) => {
    monacoRef.current = monacoEditor
    // Flush any sync that was requested before Monaco finished mounting.
    reconcileActivePane()
  }, [reconcileActivePane])

  const handleRawChange = useCallback((value: string | undefined) => {
    if (syncingMonacoRef.current || value === undefined) return
    currentContentRef.current = value
    rawSyncedRef.current = value
    updateDirty(value)
  }, [updateDirty])

  const handlePreviewUpdated = useCallback((markdown: string) => {
    // Ignore only the debounced bounce from a programmatic replace: it arrives
    // within the suppress window AND its value matches what we just pushed. A
    // genuine edit differs in value, so it is never suppressed — even one made
    // inside the window — and a late bounce past the window falls through to a
    // harmless no-op dirty check.
    if (Date.now() < suppressPreviewUntilRef.current && markdown === lastPushedToPreviewRef.current) {
      return
    }
    currentContentRef.current = markdown
    previewSyncedRef.current = markdown
    updateDirty(markdown)
  }, [updateDirty])

  if (error) {
    return (
      <div
        className="h-full w-full flex items-center justify-center text-destructive"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        <p>Error: {error}</p>
      </div>
    )
  }

  if (content === null) {
    return (
      <div
        className="h-full w-full flex items-center justify-center text-muted-foreground"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', height: '100%', width: '100%' }}>
      {isDeletedExternally && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>This file has been deleted. Save to recreate it.</span>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        {/* Raw pane (Monaco) — both panes stay mounted; visibility toggles which
            one shows so each keeps its own scroll position (not display:none,
            which would zero layout and reset scroll geometry on reveal). */}
        <div style={{ position: 'absolute', inset: 0, visibility: mode === 'raw' ? 'visible' : 'hidden' }}>
          <Editor
            defaultValue={content}
            language="markdown"
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
            onMount={handleRawMount}
            onChange={handleRawChange}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>
        {/* Preview pane (Milkdown) */}
        <div style={{ position: 'absolute', inset: 0, visibility: mode === 'preview' ? 'visible' : 'hidden' }}>
          <MarkdownPreviewPane
            ref={previewRef}
            defaultValue={content}
            onMarkdownUpdated={handlePreviewUpdated}
            onReady={reconcileActivePane}
          />
        </div>
      </div>
    </div>
  )
}
