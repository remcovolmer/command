import { useEffect, useRef, useMemo, useCallback } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ChevronDown, ChevronUp, X, TerminalSquare } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { terminalEvents } from '../../utils/terminalEvents'

interface SidecarTerminalProps {
  terminalId: string
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose: () => void
}

// Helper to get computed CSS variable value as hex
function getCssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (value.startsWith('#')) return value
  const temp = document.createElement('div')
  temp.style.color = value
  document.body.appendChild(temp)
  const computed = getComputedStyle(temp).color
  document.body.removeChild(temp)
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

export function SidecarTerminal({
  terminalId,
  isCollapsed,
  onToggleCollapse,
  onClose,
}: SidecarTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isDisposedRef = useRef(false)
  const isReadyRef = useRef(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitializedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const updateTerminalState = useProjectStore((s) => s.updateTerminalState)
  const theme = useProjectStore((s) => s.theme)
  const api = useMemo(() => getElectronAPI(), [])

  // Safe fit function that checks all prerequisites
  const safeFit = useCallback(() => {
    if (
      isDisposedRef.current ||
      !isReadyRef.current ||
      !fitAddonRef.current ||
      !terminalRef.current ||
      !containerRef.current
    ) {
      return
    }

    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth === 0 || clientHeight === 0) {
      return
    }

    const terminalElement = containerRef.current.querySelector('.xterm')
    if (!terminalElement) {
      return
    }

    const terminalCore = terminalRef.current as unknown as { element?: HTMLElement }
    if (!terminalCore.element?.offsetParent) {
      return
    }

    try {
      fitAddonRef.current.fit()
    } catch {
      // Ignore fit errors
    }
  }, [])

  // Initialize terminal when not collapsed
  useEffect(() => {
    if (hasInitializedRef.current) return
    if (isCollapsed) return
    if (!containerRef.current) return

    hasInitializedRef.current = true
    isDisposedRef.current = false
    isReadyRef.current = false

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
      lineHeight: 1.2,
      scrollback: 5000,
      theme: buildTerminalTheme(),
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
          navigator.clipboard.writeText(selection)
          return false
        }
        return true
      }

      if (event.ctrlKey && event.key === 'v') {
        event.preventDefault()
        navigator.clipboard.readText().then((text) => {
          if (text && !isDisposedRef.current) {
            api.terminal.write(terminalId, text)
          }
        })
        return false
      }

      return true
    })

    const readyTimer = setTimeout(() => {
      if (!isDisposedRef.current) {
        isReadyRef.current = true
        safeFit()
      }
    }, 50)

    terminal.onData((data) => {
      api.terminal.write(terminalId, data)
    })

    terminal.onResize(({ cols, rows }) => {
      api.terminal.resize(terminalId, cols, rows)
    })

    // Subscribe to terminal events
    terminalEvents.subscribe(
      terminalId,
      (data) => {
        if (terminalRef.current && !isDisposedRef.current) {
          terminalRef.current.write(data)
        }
      },
      (state) => {
        updateTerminalState(terminalId, state)
      },
      () => {
        // Terminal exited - trigger close
        onClose()
      },
      undefined // No title updates for normal terminals
    )

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        safeFit()
      }, 100)
    })
    resizeObserver.observe(containerRef.current)

    cleanupRef.current = () => {
      isDisposedRef.current = true
      isReadyRef.current = false
      hasInitializedRef.current = false
      clearTimeout(readyTimer)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeObserver.disconnect()
      terminalEvents.unsubscribe(terminalId)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCollapsed, terminalId, updateTerminalState, api, safeFit, onClose])

  // Cleanup on unmount
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

  // Refit when uncollapsed
  useEffect(() => {
    if (!isCollapsed && terminalRef.current) {
      terminalRef.current.focus()
      const timer = setTimeout(() => {
        safeFit()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isCollapsed, safeFit])

  return (
    <div className="flex flex-col h-full">
      {/* Header - always visible */}
      <div className="flex items-center justify-between px-2 py-1 bg-sidebar-accent border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Terminal</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-muted/50 transition-colors"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted/50 transition-colors"
            title="Close Terminal"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Terminal content - hidden when collapsed */}
      {!isCollapsed && (
        <div
          ref={containerRef}
          className="terminal-container flex-1 min-h-0 bg-sidebar"
        />
      )}
    </div>
  )
}
