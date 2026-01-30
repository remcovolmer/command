import { useEffect, useRef, useMemo, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useProjectStore } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import { terminalEvents } from '../utils/terminalEvents'
import { buildTerminalTheme, invalidateTerminalThemeCache } from '../utils/terminalTheme'

// Timing constants for terminal dimension calculations
const FIT_RETRY_DELAY_MS = 50
const FIT_MAX_RETRIES = 5
const RESIZE_DEBOUNCE_MS = 100
const READY_DELAY_MS = 50
const FOCUS_REFIT_DELAY_MS = 50

export interface UseXtermInstanceOptions {
  id: string
  isActive: boolean
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
  fontSize = 14,
  scrollback = 5000,
  onExit,
  onTitle,
}: UseXtermInstanceOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isDisposedRef = useRef(false)
  const isReadyRef = useRef(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitializedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  const updateTerminalState = useProjectStore((s) => s.updateTerminalState)
  const updateTerminalTitle = useProjectStore((s) => s.updateTerminalTitle)
  const theme = useProjectStore((s) => s.theme)
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
      fitAddonRef.current.fit()
    } catch {
      // Ignore fit errors (can happen during rapid resizing or disposal)
    }
  }, [])

  // Initialize terminal - deferred until active to ensure container has dimensions
  useEffect(() => {
    if (hasInitializedRef.current) return
    if (!isActive) return
    if (!containerRef.current) return

    hasInitializedRef.current = true
    isDisposedRef.current = false
    isReadyRef.current = false

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
      lineHeight: 1.2,
      scrollback,
      theme: buildTerminalTheme(theme),
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle Ctrl+C (copy when selected, otherwise send SIGINT) and Ctrl+V (paste)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      if (event.ctrlKey && event.key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
          return false
        }
        return true
      }

      if (event.ctrlKey && event.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text && !isDisposedRef.current) {
            api.terminal.write(id, text)
          }
        }).catch(() => {})
        return false
      }

      return true
    })

    const readyTimer = setTimeout(() => {
      if (!isDisposedRef.current) {
        isReadyRef.current = true
        safeFit()
      }
    }, READY_DELAY_MS)

    terminal.onData((data) => {
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
      onTitle ?? ((title) => {
        updateTerminalTitle(id, title)
      })
    )

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
      terminalEvents.unsubscribe(id)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, id, updateTerminalState, updateTerminalTitle, api, safeFit])

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [])

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current && !isDisposedRef.current) {
      invalidateTerminalThemeCache()
      terminalRef.current.options.theme = buildTerminalTheme(theme)
    }
  }, [theme])

  // Focus terminal when active and refit
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      const timer = setTimeout(() => {
        safeFit()
      }, FOCUS_REFIT_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [isActive, safeFit])

  return containerRef
}
