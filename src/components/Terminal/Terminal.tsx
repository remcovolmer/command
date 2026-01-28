import { useEffect, useRef, useMemo, useCallback } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { terminalEvents } from '../../utils/terminalEvents'

interface TerminalProps {
  id: string
  isActive: boolean
}

// Helper to get computed CSS variable value as hex
function getCssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // If it's already hex, return it
  if (value.startsWith('#')) return value
  // If it's oklch, we need to convert it
  // Create a temporary element to compute the color
  const temp = document.createElement('div')
  temp.style.color = value
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)
  // Convert rgb(r, g, b) to hex
  const match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0')
    const g = parseInt(match[2]).toString(16).padStart(2, '0')
    const b = parseInt(match[3]).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return value
}

// Build terminal theme from CSS variables
function buildTerminalTheme(): ITheme {
  const bg = getCssVar('--sidebar')
  const fg = getCssVar('--sidebar-foreground')
  const primary = getCssVar('--primary')
  const muted = getCssVar('--muted-foreground')
  const accent = getCssVar('--sidebar-accent')

  return {
    background: bg,
    foreground: fg,
    cursor: primary,
    cursorAccent: bg,
    selectionBackground: accent,
    black: getCssVar('--background'),
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: fg,
    brightBlack: muted,
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#ffffff',
  }
}

export function Terminal({ id, isActive }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isDisposedRef = useRef(false)
  const isReadyRef = useRef(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitializedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const updateTerminalState = useProjectStore((s) => s.updateTerminalState)
  const updateTerminalTitle = useProjectStore((s) => s.updateTerminalTitle)
  const theme = useProjectStore((s) => s.theme)
  const api = useMemo(() => getElectronAPI(), [])

  // Safe fit function with retry logic for race conditions
  const safeFit = useCallback((attempt = 0) => {
    const maxRetries = 5
    const retryDelay = 50

    // Check disposal and basic refs
    if (
      isDisposedRef.current ||
      !fitAddonRef.current ||
      !terminalRef.current ||
      !containerRef.current
    ) {
      return
    }

    // Check container has dimensions - retry if not yet rendered
    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth === 0 || clientHeight === 0) {
      if (attempt < maxRetries) {
        setTimeout(() => safeFit(attempt + 1), retryDelay)
      }
      return
    }

    // Check that xterm has fully initialized by verifying the DOM element exists
    const terminalElement = containerRef.current.querySelector('.xterm')
    if (!terminalElement) {
      if (attempt < maxRetries) {
        setTimeout(() => safeFit(attempt + 1), retryDelay)
      }
      return
    }

    // Verify the terminal's internal element is still attached and has dimensions
    const terminalCore = terminalRef.current as unknown as { element?: HTMLElement }
    if (!terminalCore.element?.offsetParent) {
      if (attempt < maxRetries) {
        setTimeout(() => safeFit(attempt + 1), retryDelay)
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
    // Skip if already initialized
    if (hasInitializedRef.current) return
    // Wait until terminal becomes active (container visible with display:block)
    if (!isActive) return
    if (!containerRef.current) return

    hasInitializedRef.current = true
    isDisposedRef.current = false
    isReadyRef.current = false

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
      lineHeight: 1.2,
      scrollback: 5000,
      theme: buildTerminalTheme(),
    })

    // Load addons
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    // Open terminal in container
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle Ctrl+C (copy when selected, otherwise send SIGINT) and Ctrl+V (paste)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      // Ctrl+C: copy if text selected, otherwise let terminal handle it (SIGINT)
      if (event.ctrlKey && event.key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false // Prevent terminal from handling it
        }
        return true // Let terminal send SIGINT
      }

      // Ctrl+V: paste from clipboard
      if (event.ctrlKey && event.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text && !isDisposedRef.current) {
            api.terminal.write(id, text)
          }
        })
        return false // Prevent terminal from handling it
      }

      return true // Let terminal handle other keys
    })

    // Mark terminal as ready after a brief delay to ensure xterm's internal services are initialized
    // Then perform initial fit
    const readyTimer = setTimeout(() => {
      if (!isDisposedRef.current) {
        isReadyRef.current = true
        safeFit()
      }
    }, 50)

    // Handle user input
    terminal.onData((data) => {
      api.terminal.write(id, data)
    })

    // Handle resize
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
      undefined, // onExit - not needed here
      (title) => {
        updateTerminalTitle(id, title)
      }
    )

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        safeFit()
      }, 100)
    })
    resizeObserver.observe(containerRef.current)

    // Watch for xterm DOM changes (e.g., viewport initialization)
    const mutationObserver = new MutationObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        safeFit()
      }, 50)
    })
    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true
    })

    // Store cleanup function in ref (will be called on unmount)
    cleanupRef.current = () => {
      isDisposedRef.current = true
      isReadyRef.current = false
      hasInitializedRef.current = false
      clearTimeout(readyTimer)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
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
      terminalRef.current.options.theme = buildTerminalTheme()
    }
  }, [theme])

  // Focus terminal when active and refit
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      // Small delay to allow layout to settle after visibility change
      const timer = setTimeout(() => {
        safeFit()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isActive, safeFit])

  return (
    <div
      ref={containerRef}
      className="terminal-container w-full h-full bg-sidebar"
      style={{
        visibility: isActive ? 'visible' : 'hidden',
        position: isActive ? 'relative' : 'absolute',
        inset: isActive ? undefined : 0,
        pointerEvents: isActive ? 'auto' : 'none'
      }}
    />
  )
}
