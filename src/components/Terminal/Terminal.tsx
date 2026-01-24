import { useEffect, useRef, useMemo, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { terminalEvents } from '../../utils/terminalEvents'

interface TerminalProps {
  id: string
  isActive: boolean
}

export function Terminal({ id, isActive }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isDisposedRef = useRef(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateTerminalState = useProjectStore((s) => s.updateTerminalState)
  const api = useMemo(() => getElectronAPI(), [])

  // Safe fit function that checks all prerequisites
  const safeFit = useCallback(() => {
    if (
      isDisposedRef.current ||
      !fitAddonRef.current ||
      !terminalRef.current ||
      !containerRef.current
    ) {
      return
    }

    // Check container has dimensions
    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth === 0 || clientHeight === 0) {
      return
    }

    try {
      fitAddonRef.current.fit()
    } catch {
      // Ignore fit errors (can happen during rapid resizing or disposal)
    }
  }, [])

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return

    isDisposedRef.current = false

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    })

    // Load addons
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    // Open terminal in container
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Delay initial fit to allow layout to settle
    requestAnimationFrame(() => {
      safeFit()
    })

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

    // Cleanup
    return () => {
      isDisposedRef.current = true
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeObserver.disconnect()
      terminalEvents.unsubscribe(id)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [id, updateTerminalState, api, safeFit])

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
      className="terminal-container w-full h-full bg-terminal-bg"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  )
}
