import { useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import type { HotkeyAction, HotkeyConfig } from '../types/hotkeys';
import { matchesBinding, DEFAULT_HOTKEY_CONFIG } from '../utils/hotkeys';

type HotkeyHandlers = Partial<Record<HotkeyAction, () => void>>;

interface UseHotkeysOptions {
  /** Whether hotkeys are enabled (default: true) */
  enabled?: boolean;
  /** Whether to capture in capture phase (default: true for global shortcuts) */
  capture?: boolean;
  /** Element to listen on (default: window) */
  target?: Window | HTMLElement | null;
}

/**
 * Hook for registering hotkey handlers
 *
 * @param handlers - Object mapping hotkey actions to handler functions
 * @param options - Configuration options
 *
 * @example
 * useHotkeys({
 *   'terminal.new': () => createTerminal(),
 *   'nav.previousProject': () => switchProject(-1),
 * });
 */
export function useHotkeys(
  handlers: HotkeyHandlers,
  options: UseHotkeysOptions = {}
): void {
  const { enabled = true, capture = true, target } = options;

  // Get hotkey config from store, fallback to defaults
  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG;

  // Use ref to avoid re-registering listener on every handler change
  const handlersRef = useRef<HotkeyHandlers>(handlers);
  handlersRef.current = handlers;

  const configRef = useRef<HotkeyConfig>(hotkeyConfig);
  configRef.current = hotkeyConfig;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if typing in input, textarea, or contenteditable
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Only allow escape and certain dialog shortcuts in inputs
      const config = configRef.current;
      if (matchesBinding(e, config['dialog.close'])) {
        const handler = handlersRef.current['dialog.close'];
        if (handler) {
          e.preventDefault();
          handler();
        }
      }
      return;
    }

    const config = configRef.current;
    const handlers = handlersRef.current;

    // Check each registered handler against the event
    for (const [action, handler] of Object.entries(handlers) as [HotkeyAction, () => void][]) {
      if (!handler) continue;

      const binding = config[action];
      if (!binding) continue;

      if (matchesBinding(e, binding)) {
        e.preventDefault();
        e.stopPropagation();
        handler();
        return;
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const eventTarget = target ?? window;
    eventTarget.addEventListener('keydown', handleKeyDown as EventListener, { capture });

    return () => {
      eventTarget.removeEventListener('keydown', handleKeyDown as EventListener, { capture });
    };
  }, [enabled, capture, target, handleKeyDown]);
}

/**
 * Hook specifically for dialog hotkeys (close on Escape, confirm on Enter)
 * Only active when the dialog is open
 */
export function useDialogHotkeys(
  onClose: () => void,
  onConfirm?: () => void,
  options: { enabled?: boolean; canConfirm?: boolean } = {}
): void {
  const { enabled = true, canConfirm = true } = options;

  const hotkeyConfig = useProjectStore((s) => s.hotkeyConfig) ?? DEFAULT_HOTKEY_CONFIG;

  // Use refs to avoid re-registering listener on every callback/config change
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const configRef = useRef(hotkeyConfig);
  configRef.current = hotkeyConfig;

  const canConfirmRef = useRef(canConfirm);
  canConfirmRef.current = canConfirm;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Close on Escape
      if (matchesBinding(e, configRef.current['dialog.close'])) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      // Confirm on Enter (if not in a textarea or if confirm is enabled)
      const target = e.target as HTMLElement;
      const isTextArea = target.tagName === 'TEXTAREA';

      if (!isTextArea && canConfirmRef.current && onConfirmRef.current && matchesBinding(e, configRef.current['dialog.confirm'])) {
        e.preventDefault();
        e.stopPropagation();
        onConfirmRef.current();
        return;
      }
    };

    // Use capture to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [enabled]);
}
