import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'
import {
  chatSelectIdFromTarget,
  focusActiveChatTerminal,
  isFocusOnBody,
  isWebviewFocused,
  readRefocusInput,
  shouldBlockFileDrop,
  shouldRefocusTerminal,
  type RefocusCause,
} from '../utils/focusRecovery'

// Grace period before recovering: components that move focus themselves in a
// rAF/timeout after a close (rename inputs, dropdown search, dialogs) win, and
// we only act if focus is still on <body> afterwards.
const RECOVERY_DELAY_MS = 50

/**
 * One generic mechanism for focus dead-ends: whenever focus falls back to
 * <body> without the user asking for it, return it to the active chat
 * terminal. Also owns the window-focus restore, the webview→host focus
 * handoff and the stray-file-drop guard. See utils/focusRecovery.ts for the
 * (tested) decisions.
 */
export function useFocusRecovery(): void {
  useEffect(() => {
    const api = getElectronAPI()
    let lastFocused: Element | null = null
    let pointerDown = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tryRecover = (cause: RefocusCause) => {
      if (shouldRefocusTerminal(readRefocusInput(cause))) focusActiveChatTerminal()
    }

    const scheduleRecovery = () => {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        tryRecover('focus-lost')
      }, RECOVERY_DELAY_MS)
    }

    const onFocusIn = (e: FocusEvent) => {
      lastFocused = e.target instanceof Element ? e.target : null
    }

    // Blur to nowhere (relatedTarget null). During a pointer press it's the
    // user clicking something non-focusable (text, empty chrome) — respect it
    // and forget the old element so a later unmount doesn't trigger recovery.
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return
      if (pointerDown) {
        lastFocused = null
        return
      }
      scheduleRecovery()
    }

    // Chromium doesn't reliably fire blur/focusout when the focused node is
    // removed from the DOM (collapsed drawer, closed find bar/menu/dialog), so
    // also watch removals: the last focused element gone + focus on <body>.
    const observer = new MutationObserver(() => {
      if (lastFocused && !lastFocused.isConnected && isFocusOnBody()) {
        lastFocused = null
        scheduleRecovery()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    const onPointerDown = (e: PointerEvent) => {
      pointerDown = true
      // The <webview> guest keeps native keyboard focus after a click into it;
      // a press anywhere in the host UI must hand focus back to the host
      // webContents or typing/hotkeys keep going to the guest. (Presses inside
      // the guest never reach this document.)
      if (isWebviewFocused() && !(e.target instanceof Element && e.target.closest('webview'))) {
        api.browser.focusHost()
      }
    }
    const onPointerEnd = () => {
      pointerDown = false
    }

    // Re-clicking the already-active chat's tab or sidebar row: the click
    // focused nothing (non-focusable row), so put the caret back in the chat.
    const onClick = (e: MouseEvent) => {
      const id = chatSelectIdFromTarget(e.target)
      if (!id || id !== useProjectStore.getState().activeTerminalId) return
      requestAnimationFrame(() => focusActiveChatTerminal())
    }

    // Window regained OS focus: Chromium restores the element that was focused
    // at blur by itself (activeElement survives a window blur), so only step in
    // when focus would otherwise be on <body>. Runs after the restore settles.
    const onWindowFocus = () => {
      requestAnimationFrame(() => tryRecover('window-focus'))
    }
    const onWindowBlur = () => {
      pointerDown = false
    }

    // Stray file drops would navigate the whole window to file://…
    const onDragOver = (e: DragEvent) => {
      if (!shouldBlockFileDrop(e.dataTransfer?.types, e.defaultPrevented)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    const onDrop = (e: DragEvent) => {
      if (shouldBlockFileDrop(e.dataTransfer?.types, e.defaultPrevented)) e.preventDefault()
    }

    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerEnd, true)
    document.addEventListener('pointercancel', onPointerEnd, true)
    document.addEventListener('click', onClick)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      if (timer !== null) clearTimeout(timer)
      observer.disconnect()
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
      document.removeEventListener('click', onClick)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])
}
