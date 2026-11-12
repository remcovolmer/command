// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  chatSelectIdFromTarget,
  focusActiveChatTerminal,
  hasFocusOwningOverlay,
  isFocusOnBody,
  readRefocusInput,
  releaseWebviewFocus,
  shouldBlockFileDrop,
  shouldConsumeToastEscape,
  shouldRefocusTerminal,
  type RefocusInput,
} from '../src/utils/focusRecovery'

const OK: RefocusInput = {
  cause: 'focus-lost',
  focusOnBody: true,
  windowFocused: true,
  overlayOpen: false,
  textSelected: false,
  terminalAvailable: true,
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('shouldRefocusTerminal', () => {
  test('refocuses when focus dead-ended on body with nothing else claiming it', () => {
    expect(shouldRefocusTerminal(OK)).toBe(true)
    expect(shouldRefocusTerminal({ ...OK, cause: 'window-focus' })).toBe(true)
  })

  test('never steals focus from a real target', () => {
    expect(shouldRefocusTerminal({ ...OK, focusOnBody: false })).toBe(false)
    expect(shouldRefocusTerminal({ ...OK, cause: 'window-focus', focusOnBody: false })).toBe(false)
  })

  test('respects a deliberate click on something non-focusable', () => {
    expect(shouldRefocusTerminal({ ...OK, cause: 'pointer' })).toBe(false)
  })

  test('stays out while a dialog/menu owns focus, text is selected, or the window is blurred', () => {
    expect(shouldRefocusTerminal({ ...OK, overlayOpen: true })).toBe(false)
    expect(shouldRefocusTerminal({ ...OK, textSelected: true })).toBe(false)
    expect(shouldRefocusTerminal({ ...OK, windowFocused: false })).toBe(false)
  })

  test('does nothing without an active chat terminal', () => {
    expect(shouldRefocusTerminal({ ...OK, terminalAvailable: false })).toBe(false)
  })
})

describe('window-focus restore decision (readRefocusInput + shouldRefocusTerminal)', () => {
  const setup = () => {
    document.body.innerHTML = `
      <div data-terminal-active="true"><textarea class="xterm-helper-textarea"></textarea></div>
      <div data-shell-drawer><textarea id="shell" class="xterm-helper-textarea"></textarea></div>`
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  }

  test('leaves the sidecar shell alone when it still holds focus', () => {
    setup()
    document.getElementById('shell')!.focus()
    expect(shouldRefocusTerminal(readRefocusInput('window-focus'))).toBe(false)
  })

  test('refocuses the chat when the element focused at blur is gone (focus on body)', () => {
    setup()
    const shell = document.getElementById('shell')!
    shell.focus()
    shell.remove()
    expect(isFocusOnBody()).toBe(true)
    expect(shouldRefocusTerminal(readRefocusInput('window-focus'))).toBe(true)
  })
})

describe('DOM helpers', () => {
  test('focusActiveChatTerminal focuses the active chat textarea only', () => {
    document.body.innerHTML = `
      <div data-terminal-active="false"><textarea id="other" class="xterm-helper-textarea"></textarea></div>
      <div data-terminal-active="true"><textarea id="active" class="xterm-helper-textarea"></textarea></div>`
    expect(focusActiveChatTerminal()).toBe(true)
    expect(document.activeElement?.id).toBe('active')
  })

  test('focusActiveChatTerminal reports false without a chat', () => {
    expect(focusActiveChatTerminal()).toBe(false)
  })

  test('hasFocusOwningOverlay detects open dialogs and menus', () => {
    expect(hasFocusOwningOverlay()).toBe(false)
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(hasFocusOwningOverlay()).toBe(true)
    document.body.innerHTML = '<div role="menu"></div>'
    expect(hasFocusOwningOverlay()).toBe(true)
  })

  test('chatSelectIdFromTarget reads chat tab and sidebar row ids', () => {
    document.body.innerHTML = `
      <div data-tab-id="tab-1"><span id="tab-label"></span></div>
      <ul><li data-chat-select-id="chat-1"><span id="row-label"></span></li></ul>
      <span id="loose"></span>`
    expect(chatSelectIdFromTarget(document.getElementById('tab-label'))).toBe('tab-1')
    expect(chatSelectIdFromTarget(document.getElementById('row-label'))).toBe('chat-1')
    expect(chatSelectIdFromTarget(document.getElementById('loose'))).toBeNull()
    expect(chatSelectIdFromTarget(null)).toBeNull()
  })
})

describe('shouldConsumeToastEscape', () => {
  test('lets Esc through to terminals (Claude Code interrupt), consumes elsewhere', () => {
    document.body.innerHTML = `
      <textarea id="xterm" class="xterm-helper-textarea"></textarea>
      <button id="btn"></button>`
    expect(shouldConsumeToastEscape(document.getElementById('xterm'))).toBe(false)
    expect(shouldConsumeToastEscape(document.getElementById('btn'))).toBe(true)
    expect(shouldConsumeToastEscape(document.body)).toBe(true)
  })
})

describe('releaseWebviewFocus', () => {
  test('blurs a focused webview and asks the host for focus', () => {
    document.body.innerHTML = '<button id="wv"></button>'
    const wv = document.getElementById('wv')!
    wv.focus()
    const focusHost = vi.fn()
    expect(releaseWebviewFocus(wv, focusHost)).toBe(true)
    expect(focusHost).toHaveBeenCalledOnce()
    expect(isFocusOnBody()).toBe(true)
  })

  test('is a no-op when the webview does not hold focus', () => {
    document.body.innerHTML = '<button id="wv"></button><button id="other"></button>'
    document.getElementById('other')!.focus()
    const focusHost = vi.fn()
    expect(releaseWebviewFocus(document.getElementById('wv'), focusHost)).toBe(false)
    expect(releaseWebviewFocus(null, focusHost)).toBe(false)
    expect(focusHost).not.toHaveBeenCalled()
  })
})

describe('shouldBlockFileDrop', () => {
  test('blocks unhandled file drags only', () => {
    expect(shouldBlockFileDrop(['Files'], false)).toBe(true)
    expect(shouldBlockFileDrop(['Files'], true)).toBe(false)
    expect(shouldBlockFileDrop(['text/plain'], false)).toBe(false)
    expect(shouldBlockFileDrop(undefined, false)).toBe(false)
  })
})
