import { useEffect, useRef, useMemo, useCallback } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ChevronDown, ChevronUp, Plus, X, TerminalSquare } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { getElectronAPI } from '../../utils/electron'
import { terminalEvents } from '../../utils/terminalEvents'
import type { TerminalSession, TerminalState } from '../../types'

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

function getStateColor(state: TerminalState): string {
  switch (state) {
    case 'busy': return 'bg-blue-500'
    case 'permission':
    case 'question': return 'bg-orange-500'
    case 'done': return 'bg-green-500'
    case 'stopped': return 'bg-red-500'
    default: return 'bg-muted-foreground'
  }
}

interface SidecarTerminalPanelProps {
  contextKey: string
  projectId: string
  worktreeId?: string
  terminals: TerminalSession[]
  activeTerminalId: string | null
  isCollapsed: boolean
  onToggleCollapse: () => void
  onCreateTerminal: () => void
  onCloseTerminal: (terminalId: string) => void
  onSelectTerminal: (terminalId: string) => void
}

function SidecarTerminalInstance({
  terminalId,
  isActive,
}: {
  terminalId: string
  isActive: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isDisposedRef = useRef(false)
  const isReadyRef = useRef(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitializedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const updateTerminalState = useProjectStore((s) => s.updateTerminalState)
  const removeTerminal = useProjectStore((s) => s.removeTerminal)
  const theme = useProjectStore((s) => s.theme)
  const api = useMemo(() => getElectronAPI(), [])

  const safeFit = useCallback(() => {
    if (
      isDisposedRef.current ||
      !isReadyRef.current ||
      !fitAddonRef.current ||
      !terminalRef.current ||
      !containerRef.current
    ) return

    const { clientWidth, clientHeight } = containerRef.current
    if (clientWidth === 0 || clientHeight === 0) return

    const terminalElement = containerRef.current.querySelector('.xterm')
    if (!terminalElement) return

    const terminalCore = terminalRef.current as unknown as { element?: HTMLElement }
    if (!terminalCore.element?.offsetParent) return

    try {
      fitAddonRef.current.fit()
    } catch {
      // Ignore fit errors
    }
  }, [])

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
        removeTerminal(terminalId)
      },
      undefined
    )

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
      resizeTimeoutRef.current = setTimeout(() => safeFit(), 100)
    })
    resizeObserver.observe(containerRef.current)

    cleanupRef.current = () => {
      isDisposedRef.current = true
      isReadyRef.current = false
      hasInitializedRef.current = false
      clearTimeout(readyTimer)
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
      resizeObserver.disconnect()
      terminalEvents.unsubscribe(terminalId)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, terminalId, updateTerminalState, removeTerminal, api, safeFit])

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    if (terminalRef.current && !isDisposedRef.current) {
      terminalRef.current.options.theme = buildTerminalTheme()
    }
  }, [theme])

  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      const timer = setTimeout(() => safeFit(), 50)
      return () => clearTimeout(timer)
    }
  }, [isActive, safeFit])

  return (
    <div
      ref={containerRef}
      className="terminal-container flex-1 min-h-0 bg-sidebar"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  )
}

export function SidecarTerminalPanel({
  contextKey,
  projectId,
  worktreeId,
  terminals,
  activeTerminalId,
  isCollapsed,
  onToggleCollapse,
  onCreateTerminal,
  onCloseTerminal,
  onSelectTerminal,
}: SidecarTerminalPanelProps) {
  const hasTerminals = terminals.length > 0

  const isExpanded = !isCollapsed && hasTerminals

  return (
    <div className={`flex flex-col shrink-0 ${isExpanded ? 'flex-1 min-h-[120px] max-h-[50%]' : ''}`}>
      {/* Header - always visible */}
      <div
        className="flex items-center justify-between px-2 py-1 bg-sidebar-accent border-t border-border shrink-0 cursor-pointer"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-2">
          {isCollapsed || !hasTerminals ? (
            <ChevronUp className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
          <TerminalSquare className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Terminal</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onCreateTerminal()
          }}
          className="p-0.5 rounded hover:bg-muted/50 transition-colors"
          title="New Terminal"
        >
          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Tab bar - visible when terminals exist (even when collapsed) */}
      {hasTerminals && (
        <div className="flex items-center bg-sidebar border-b border-border shrink-0 overflow-x-auto">
          {terminals.map((term) => {
            const isActive = term.id === activeTerminalId
            return (
              <button
                key={term.id}
                onClick={() => onSelectTerminal(term.id)}
                className={`
                  flex items-center gap-1 px-2 py-1 text-xs whitespace-nowrap shrink-0
                  transition-colors border-b-2
                  ${isActive
                    ? 'border-primary text-sidebar-foreground bg-sidebar-accent/50'
                    : 'border-transparent text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/30'
                  }
                `}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStateColor(term.state)}`} />
                <span className="truncate max-w-[80px]">{term.title || 'Terminal'}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTerminal(term.id)
                  }}
                  className="p-0.5 rounded hover:bg-muted/50 ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Terminal content - hidden when collapsed */}
      {!isCollapsed && hasTerminals && (
        <div className="flex-1 min-h-0 relative">
          {terminals.map((term) => (
            <SidecarTerminalInstance
              key={term.id}
              terminalId={term.id}
              isActive={term.id === activeTerminalId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
