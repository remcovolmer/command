// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  dispatchHotkey,
  getFocusContext,
  isActionInScope,
  type FocusContext,
  type HotkeyHandlers,
} from '../src/utils/hotkeyDispatch'
import { DEFAULT_HOTKEY_CONFIG } from '../src/utils/hotkeys'
import type { HotkeyAction } from '../src/types/hotkeys'

const NO_REGION: FocusContext = {
  inChatTerminal: false,
  inShellDrawer: false,
  inFileExplorer: false,
  inSidebar: false,
  inBrowser: false,
}
const ctx = (over: Partial<FocusContext>): FocusContext => ({ ...NO_REGION, ...over })

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  new KeyboardEvent('keydown', {
    key: k,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  })

describe('dispatchHotkey — handled vs not handled', () => {
  test('returns the action when its handler reports handled', () => {
    const handler = vi.fn(() => true)
    const result = dispatchHotkey(
      key('t', { ctrl: true }),
      DEFAULT_HOTKEY_CONFIG,
      { 'terminal.new': handler },
      NO_REGION
    )
    expect(result).toBe('terminal.new')
    expect(handler).toHaveBeenCalledOnce()
  })

  test('returns null when the handler declines, so the key is not consumed', () => {
    const handler = vi.fn(() => false)
    const result = dispatchHotkey(
      key('Tab', { ctrl: true }),
      DEFAULT_HOTKEY_CONFIG,
      { 'editor.nextTab': handler },
      NO_REGION
    )
    expect(handler).toHaveBeenCalledOnce()
    expect(result).toBeNull()
  })

  test('returns null when no binding matches', () => {
    const handler = vi.fn(() => true)
    expect(
      dispatchHotkey(key('x'), DEFAULT_HOTKEY_CONFIG, { 'terminal.new': handler }, NO_REGION)
    ).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  test('a declining handler lets a later action on the same key handle it', () => {
    const config = {
      ...DEFAULT_HOTKEY_CONFIG,
      // User rebinding that collides with Ctrl+T.
      'ui.toggleTheme': { ...DEFAULT_HOTKEY_CONFIG['ui.toggleTheme'], modifiers: ['ctrl' as const] },
    }
    const first = vi.fn(() => false)
    const second = vi.fn(() => true)
    const result = dispatchHotkey(
      key('t', { ctrl: true }),
      config,
      { 'terminal.new': first, 'ui.toggleTheme': second },
      NO_REGION
    )
    expect(result).toBe('ui.toggleTheme')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  test('disabled bindings never fire', () => {
    const config = {
      ...DEFAULT_HOTKEY_CONFIG,
      'terminal.new': { ...DEFAULT_HOTKEY_CONFIG['terminal.new'], enabled: false },
    }
    const handler = vi.fn(() => true)
    expect(
      dispatchHotkey(key('t', { ctrl: true }), config, { 'terminal.new': handler }, NO_REGION)
    ).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  test('falls back to the default binding when a persisted config lacks the action', () => {
    const config: Partial<typeof DEFAULT_HOTKEY_CONFIG> = { ...DEFAULT_HOTKEY_CONFIG }
    delete config['shell.toggle']
    const handler = vi.fn(() => true)
    expect(
      dispatchHotkey(key('\\', { ctrl: true }), config, { 'shell.toggle': handler }, NO_REGION)
    ).toBe('shell.toggle')
  })
})

describe('dispatchHotkey — region scoping', () => {
  test('Delete only reaches fileExplorer.delete with focus in the explorer', () => {
    const handler = vi.fn(() => true)
    const handlers: HotkeyHandlers = { 'fileExplorer.delete': handler }
    expect(
      dispatchHotkey(key('Delete'), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inChatTerminal: true }))
    ).toBeNull()
    expect(handler).not.toHaveBeenCalled()
    expect(
      dispatchHotkey(key('Delete'), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inFileExplorer: true }))
    ).toBe('fileExplorer.delete')
  })

  test('Ctrl+W (terminal.close) passes through in the shell drawer and the browser pane', () => {
    const handler = vi.fn(() => true)
    const handlers: HotkeyHandlers = { 'terminal.close': handler }
    const ctrlW = () => key('w', { ctrl: true })
    expect(dispatchHotkey(ctrlW(), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inShellDrawer: true }))).toBeNull()
    expect(dispatchHotkey(ctrlW(), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inBrowser: true }))).toBeNull()
    expect(handler).not.toHaveBeenCalled()
    expect(
      dispatchHotkey(ctrlW(), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inChatTerminal: true }))
    ).toBe('terminal.close')
    expect(dispatchHotkey(ctrlW(), DEFAULT_HOTKEY_CONFIG, handlers, NO_REGION)).toBe('terminal.close')
  })

  test('Ctrl+F (browser.find) only with focus in the browser pane', () => {
    const handler = vi.fn(() => true)
    const handlers: HotkeyHandlers = { 'browser.find': handler }
    const ctrlF = () => key('f', { ctrl: true })
    expect(
      dispatchHotkey(ctrlF(), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inChatTerminal: true }))
    ).toBeNull()
    expect(dispatchHotkey(ctrlF(), DEFAULT_HOTKEY_CONFIG, handlers, ctx({ inBrowser: true }))).toBe(
      'browser.find'
    )
  })

  test('F2 renames in the explorer or the sidebar, nowhere else', () => {
    expect(isActionInScope('fileExplorer.rename', ctx({ inFileExplorer: true }))).toBe(true)
    expect(isActionInScope('fileExplorer.rename', ctx({ inSidebar: true }))).toBe(true)
    expect(isActionInScope('fileExplorer.rename', ctx({ inChatTerminal: true }))).toBe(false)
  })

  test('explorer item and git actions are explorer-scoped; navigation stays global', () => {
    const explorerScoped: HotkeyAction[] = [
      'fileExplorer.newFile',
      'fileExplorer.newFolder',
      'fileExplorer.copyPath',
      'git.stageAll',
      'git.unstageAll',
      'git.commit',
      'git.discardAll',
    ]
    for (const action of explorerScoped) {
      expect(isActionInScope(action, ctx({ inChatTerminal: true })), action).toBe(false)
      expect(isActionInScope(action, ctx({ inFileExplorer: true })), action).toBe(true)
    }
    const global: HotkeyAction[] = ['terminal.new', 'fileExplorer.toggle', 'nav.nextProject']
    for (const action of global) {
      expect(isActionInScope(action, ctx({ inShellDrawer: true })), action).toBe(true)
    }
  })
})

describe('getFocusContext', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('derives regions from the closest region markers', () => {
    document.body.innerHTML = `
      <div class="chat-terminal"><textarea id="chat" class="xterm-helper-textarea"></textarea></div>
      <div data-shell-drawer><textarea id="shell" class="xterm-helper-textarea"></textarea></div>
      <div data-file-explorer><button id="tree"></button></div>
      <div data-sidebar><button id="side"></button></div>
      <div data-browser-pane><button id="reload"></button></div>`
    const at = (id: string) => getFocusContext(document.getElementById(id))
    expect(at('chat')).toEqual(ctx({ inChatTerminal: true }))
    expect(at('shell')).toEqual(ctx({ inShellDrawer: true }))
    expect(at('tree')).toEqual(ctx({ inFileExplorer: true }))
    expect(at('side')).toEqual(ctx({ inSidebar: true }))
    expect(at('reload')).toEqual(ctx({ inBrowser: true }))
  })

  test('non-element targets map to no region', () => {
    expect(getFocusContext(null)).toEqual(NO_REGION)
    expect(getFocusContext(window)).toEqual(NO_REGION)
  })
})
