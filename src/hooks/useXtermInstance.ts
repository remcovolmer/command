import { useEffect, useRef, useMemo, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebglAddon } from '@xterm/addon-webgl'
import { useProjectStore } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import { terminalEvents } from '../utils/terminalEvents'
import {
  buildTerminalTheme,
  buildTerminalThemeOptions,
  invalidateTerminalThemeCache,
} from '../utils/terminalTheme'
import { createFileLinkProvider } from '../utils/fileLinkProvider'
import { classifyOsc8Uri } from '../utils/osc8LinkRouter'
import { isHtmlFile } from '../utils/editorLanguages'
import { terminalPool } from '../utils/terminalPool'
import { createSpaceKeyWatchdog } from '../utils/spaceKeyWatchdog'
import { createOsc52ClipboardHandler } from '../utils/osc52Clipboard'

// Timing constants for terminal dimension calculations
const FIT_RETRY_DELAY_MS = 50
const FIT_MAX_RETRIES = 5
const RESIZE_DEBOUNCE_MS = 100
const READY_DELAY_MS = 50
const FOCUS_REFIT_DELAY_MS = 50

export interface UseXtermInstanceOptions {
  id: string
  isActive: boolean
  projectId: string
  fontSize?: number
  scrollback?: number
  onExit?: () => void
  onTitle?: (title: string) => void
}

/**
 * Shared hook for managing an xterm.js terminal instance.
 * Handles initialization, fit logic with retries, keyboard shortcuts,
 * event subscriptions, theme sync, and cleanup.
 *
 * Returns a containerRef to attach to the DOM element.
 */
export function useXtermInstance({
  id,
  isActive,
  projectId,
  fontSize = 14,
  scrollback = 5000,
  onExit,
  onTitle,
}: UseXtermInstanceOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const serializeAddonRef = useRef<SerializeAddon | null>(null)
  const isDisposedRef = useRef(false)
  const isReadyRef = useRef(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitializedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  const updateTerminalState = useProjectStore((s) => s.updateTerminalState)
  const updateTerminalTitle = useProjectStore((s) => s.updateTerminalTitle)
  const resolvedTheme = useProjectStore((s) => s.resolvedTheme)
  const terminalState = useProjectStore((s) => s.terminals[id]?.state)
  const api = useMemo(() => getElectronAPI(), [])

  // Safe fit function with retry logic for race conditions
  const safeFit = useCallback((attempt = 0) => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    if (
      isDisposedRef.current ||
      !fitAddonRef.current ||
      !terminalRef.current ||
      !containerRef.current
    ) {
      return
    }

    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth === 0 || clientHeight === 0) {
      if (attempt < FIT_MAX_RETRIES) {
        retryTimeoutRef.current = setTimeout(() => safeFit(attempt + 1), FIT_RETRY_DELAY_MS)
      }
      return
    }

    const terminalElement = containerRef.current.querySelector('.xterm')
    if (!terminalElement) {
      if (attempt < FIT_MAX_RETRIES) {
        retryTimeoutRef.current = setTimeout(() => safeFit(attempt + 1), FIT_RETRY_DELAY_MS)
      }
      return
    }

    // INTERNAL API: xterm.js exposes the underlying DOM element via an internal
    // 'element' property. We check offsetParent to verify the terminal is attached
    // to the DOM and visible (offsetParent is null for display:none or detached elements).
    // This may need updating if xterm.js internals change in future versions.
    const terminalCore = terminalRef.current as unknown as { element?: HTMLElement }
    if (!terminalCore.element?.offsetParent) {
      if (attempt < FIT_MAX_RETRIES) {
        retryTimeoutRef.current = setTimeout(() => safeFit(attempt + 1), FIT_RETRY_DELAY_MS)
      }
      return
    }

    try {
      const term = terminalRef.current
      const prevCols = term.cols
      const prevRows = term.rows
      fitAddonRef.current.fit()
      // FitAddon.fit() is a complete no-op when the proposed cols/rows equal the
      // current dimensions (verified in @xterm/addon-fit): it skips terminal.resize(),
      // so xterm never re-syncs the viewport scroll area. When the buffer has grown
      // (long conversations) but the container size is unchanged, the scrollbar can
      // stay stale and disappear until a real resize happens. Force an immediate
      // viewport re-sync in that case so scrollability is restored without a resize.
      if (term.cols === prevCols && term.rows === prevRows) {
        const core = term as unknown as {
          _core?: { viewport?: { syncScrollArea?: (immediate?: boolean) => void } }
        }
        core._core?.viewport?.syncScrollArea?.(true)
      }
    } catch {
      // Ignore fit/sync errors (can happen during rapid resizing or disposal)
    }
  }, [])

  // Initialize terminal - deferred until active to ensure container has dimensions
  useEffect(() => {
    if (hasInitializedRef.current) return
    if (!isActive) return
    if (!containerRef.current) return
    // Container must have dimensions before xterm can open (avoids 'dimensions' error)
    if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return

    hasInitializedRef.current = true
    isDisposedRef.current = false
    isReadyRef.current = false

    // Resolve project/worktree base path up front — shared by linkHandler (OSC 8
    // hyperlinks below) and the FileLinkProvider (plain-text paths, registered
    // after terminal.open). Empty for sidecar/normal terminals without a project.
    const store = useProjectStore.getState()
    const termSession = store.terminals[id]
    const worktree = termSession?.worktreeId ? store.worktrees[termSession.worktreeId] : null
    const project = store.projects.find((p) => p.id === projectId)
    const contextPath = projectId ? worktree?.path || project?.path || '' : ''

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
      lineHeight: 1.0,
      scrollback,
      ...buildTerminalThemeOptions(resolvedTheme),
      allowProposedApi: true,
      letterSpacing: 0,
      customGlyphs: true,
      // OSC 8 hyperlink handler for chat terminals. Claude Code wraps every
      // markdown link in OSC 8 with a bare relative path as URI; xterm's default
      // filters non-HTTP protocols, so allowNonHttpProtocols is required. The
      // classifier in osc8LinkRouter is the single security chokepoint.
      linkHandler: contextPath
        ? {
            allowNonHttpProtocols: true,
            activate: (_event, text) => {
              const decision = classifyOsc8Uri(text, contextPath)
              if (decision.kind === 'external') {
                api.shell.openExternal(decision.url).catch(console.error)
                return
              }
              if (decision.kind === 'editor' || decision.kind === 'browser') {
                const openInBrowser = decision.kind === 'browser'
                const fileName = decision.fileName
                api.fs
                  .stat(decision.resolved)
                  .then((stat) => {
                    if (stat.exists && stat.isFile) {
                      if (openInBrowser) {
                        store.openFileInBrowser(stat.resolved, fileName, projectId)
                      } else {
                        store.openEditorTab(stat.resolved, fileName, projectId)
                      }
                    }
                  })
                  .catch(() => {
                    /* silent — fs:stat never throws but defense in depth */
                  })
                return
              }
              // decision.kind === 'ignore' — silent no-op (wrong extension, traversal,
              // unsupported scheme, oversized URI, etc.)
            },
          }
        : undefined,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(
      new WebLinksAddon((_event: MouseEvent, uri: string) => {
        api.shell.openExternal(uri).catch(console.error)
      })
    )

    // Unicode 11 addon for better wide character and emoji support
    const unicodeAddon = new Unicode11Addon()
    terminal.loadAddon(unicodeAddon)

    // Serialize addon for LRU pool eviction
    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(serializeAddon)
    serializeAddonRef.current = serializeAddon

    terminal.open(containerRef.current)

    // WebGL renderer for sharper block character and glyph rendering
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      terminal.loadAddon(webglAddon)
    } catch {
      // WebGL not available, fall back to default canvas renderer
      webglAddon = null
    }

    // Restore serialized buffer if this terminal was previously evicted
    const wasEvicted = terminalPool.isEvicted(id)
    if (wasEvicted) {
      const savedBuffer = terminalPool.getBuffer(id)
      if (savedBuffer) {
        terminal.write(savedBuffer)
      }
      terminalPool.clearBuffer(id)
      terminalPool.markRestored(id)
    }

    // Register pool callbacks for LRU eviction
    terminalPool.registerCallbacks(
      id,
      () => {
        // Serializer: serialize the current scrollback buffer
        try {
          return serializeAddonRef.current?.serialize() ?? null
        } catch {
          return null
        }
      },
      () => {
        // Cleanup: destroy the xterm instance
        cleanupRef.current?.()
        cleanupRef.current = null
      }
    )
    terminalPool.touch(id)

    // Activate Unicode 11 for correct character width calculations
    terminal.unicode.activeVersion = '11'

    // Register file link provider for plain-text clickable file paths (Ctrl+click).
    // OSC 8 hyperlinks are handled separately by linkHandler above.
    if (projectId && contextPath) {
      terminal.registerLinkProvider(
        createFileLinkProvider(terminal, contextPath, api, (filePath, fileName) => {
          // HTML paths open in the built-in browser, consistent with OSC 8 links.
          if (isHtmlFile(fileName)) {
            store.openFileInBrowser(filePath, fileName, projectId)
          } else {
            store.openEditorTab(filePath, fileName, projectId)
          }
        })
      )
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Recover spaces that a Windows IME/text-suggestion layer eats: those
    // keydowns arrive as keyCode 229 and xterm drops them by design (only
    // textarea diffs are forwarded, and the layer inserts no space). The
    // watchdog injects the space when no space data follows the keydown.
    const spaceWatchdog = createSpaceKeyWatchdog({
      writeSpace: () => {
        if (!isDisposedRef.current) {
          api.terminal.write(id, ' ')
        }
      },
    })

    // Handle Ctrl+C (copy when selected, otherwise send SIGINT) and Ctrl+V (paste)
    terminal.attachCustomKeyEventHandler((event) => {
      spaceWatchdog.handleKeyEvent(event)

      if (event.type !== 'keydown') return true

      if (event.ctrlKey && event.key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          // Electron-native clipboard: navigator.clipboard is unavailable in the
          // packaged file:// renderer, so copy silently no-ops there.
          api.clipboard.writeText(selection)
          return false
        }
        return true
      }

      if (event.ctrlKey && event.key === 'v') {
        event.preventDefault()
        api.clipboard
          .readText()
          .then((text) => {
            if (text && !isDisposedRef.current) {
              api.terminal.write(id, text)
            }
          })
          .catch(() => {})
        return false
      }

      return true
    })

    // Honor OSC 52 clipboard writes. Claude Code implements copy-on-select and
    // /copy by emitting OSC 52; xterm has no built-in handler and drops it, so
    // those copies never reach the clipboard. Route writes through the same
    // Electron-native clipboard the Ctrl+C path uses. Reads are refused inside
    // the handler (clipboard-exfiltration vector).
    const osc52 = createOsc52ClipboardHandler({
      writeText: (text) => api.clipboard.writeText(text),
    })
    const osc52Disposable = terminal.parser.registerOscHandler(52, (data) => {
      osc52.handle(data)
      return true
    })

    const readyTimer = setTimeout(() => {
      if (!isDisposedRef.current) {
        isReadyRef.current = true
        safeFit()
      }
    }, READY_DELAY_MS)

    terminal.onData((data) => {
      spaceWatchdog.handleData(data)
      api.terminal.write(id, data)
    })

    terminal.onResize(({ cols, rows }) => {
      api.terminal.resize(id, cols, rows)
    })

    // Subscribe to terminal events via centralized manager
    terminalEvents.subscribe(
      id,
      (data) => {
        if (terminalRef.current && !isDisposedRef.current) {
          terminalRef.current.write(data)
        }
      },
      (state) => {
        updateTerminalState(id, state)
      },
      onExit ? () => onExit() : undefined,
      onTitle ??
        ((title) => {
          updateTerminalTitle(id, title)
        })
    )

    // Flush main-process buffer after subscribing to events (ensures flushed data is captured)
    if (wasEvicted) {
      api.terminal.restore(id)
    }

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        safeFit()
      }, RESIZE_DEBOUNCE_MS)
    })
    resizeObserver.observe(containerRef.current)

    // Watch for xterm initial DOM setup (viewport initialization)
    const mutationObserver = new MutationObserver(() => {
      if (!containerRef.current) return
      const viewport = containerRef.current.querySelector('.xterm-viewport')
      if (viewport && viewport.clientWidth > 0 && viewport.clientHeight > 0) {
        mutationObserver.disconnect()
        safeFit()
      }
    })
    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: false,
    })

    cleanupRef.current = () => {
      isDisposedRef.current = true
      isReadyRef.current = false
      hasInitializedRef.current = false
      clearTimeout(readyTimer)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      spaceWatchdog.dispose()
      osc52Disposable.dispose()
      terminalEvents.unsubscribe(id)
      terminalPool.unregisterCallbacks(id)
      // Dispose WebGL addon before terminal to avoid _isDisposed race
      try {
        webglAddon?.dispose()
      } catch {
        /* already disposed */
      }
      webglAddon = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      serializeAddonRef.current = null
    }
    // Intentionally excludes: projectId, onExit, onTitle, fontSize, scrollback.
    // This effect initializes once per terminal (guarded by hasInitializedRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, id, updateTerminalState, updateTerminalTitle, api, safeFit])

  // Cleanup on unmount only (terminal closed or component removed)
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
      // Only remove from pool if terminal is actually closing (not just remounting).
      // This preserves serialized buffers for evicted terminals across React remounts.
      const terminals = useProjectStore.getState().terminals
      if (!terminals[id]) {
        terminalPool.remove(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current && !isDisposedRef.current) {
      invalidateTerminalThemeCache()
      terminalRef.current.options.theme = buildTerminalTheme(resolvedTheme)
    }
  }, [resolvedTheme])

  // Focus terminal when active and refit
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      // Force cursor refresh to ensure cursor is visible after focus
      terminalRef.current.refresh(0, terminalRef.current.rows - 1)
      const timer = setTimeout(() => {
        safeFit()
      }, FOCUS_REFIT_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [isActive, id, safeFit])

  // Re-fit when terminal state changes (e.g. Claude finishes)
  // State changes trigger re-renders that can desync xterm viewport dimensions
  useEffect(() => {
    if (isActive && terminalRef.current && isReadyRef.current) {
      const timer = setTimeout(() => {
        safeFit()
      }, FOCUS_REFIT_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [terminalState, isActive, safeFit])

  return containerRef
}
