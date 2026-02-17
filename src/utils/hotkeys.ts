import type { HotkeyAction, HotkeyBinding, HotkeyConfig, ModifierKey } from '../types/hotkeys';

/**
 * Default hotkey configuration
 */
export const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  // Navigation
  'nav.previousProject': {
    key: 'ArrowUp',
    modifiers: ['ctrl'],
    description: 'Switch to previous project',
    category: 'navigation',
    enabled: true,
  },
  'nav.nextProject': {
    key: 'ArrowDown',
    modifiers: ['ctrl'],
    description: 'Switch to next project',
    category: 'navigation',
    enabled: true,
  },
  'nav.previousTerminal': {
    key: 'ArrowLeft',
    modifiers: ['ctrl'],
    description: 'Switch to previous terminal',
    category: 'navigation',
    enabled: true,
  },
  'nav.nextTerminal': {
    key: 'ArrowRight',
    modifiers: ['ctrl'],
    description: 'Switch to next terminal',
    category: 'navigation',
    enabled: true,
  },
  'nav.focusSidebar': {
    key: '1',
    modifiers: ['ctrl'],
    description: 'Focus sidebar',
    category: 'navigation',
    enabled: true,
  },
  'nav.focusTerminal': {
    key: '2',
    modifiers: ['ctrl'],
    description: 'Focus terminal',
    category: 'navigation',
    enabled: true,
  },
  'nav.focusFileExplorer': {
    key: '3',
    modifiers: ['ctrl'],
    description: 'Focus file explorer',
    category: 'navigation',
    enabled: true,
  },

  // Terminal operations
  'terminal.new': {
    key: 't',
    modifiers: ['ctrl'],
    description: 'Create new terminal',
    category: 'terminal',
    enabled: true,
  },
  'terminal.close': {
    key: 'w',
    modifiers: ['ctrl'],
    description: 'Close active terminal',
    category: 'terminal',
    enabled: true,
  },
  'terminal.split': {
    key: '\\',
    modifiers: ['ctrl'],
    description: 'Add terminal to split view',
    category: 'terminal',
    enabled: true,
  },
  'terminal.unsplit': {
    key: '\\',
    modifiers: ['ctrl', 'shift'],
    description: 'Remove from split view',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo1': {
    key: '1',
    modifiers: ['alt'],
    description: 'Go to terminal 1',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo2': {
    key: '2',
    modifiers: ['alt'],
    description: 'Go to terminal 2',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo3': {
    key: '3',
    modifiers: ['alt'],
    description: 'Go to terminal 3',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo4': {
    key: '4',
    modifiers: ['alt'],
    description: 'Go to terminal 4',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo5': {
    key: '5',
    modifiers: ['alt'],
    description: 'Go to terminal 5',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo6': {
    key: '6',
    modifiers: ['alt'],
    description: 'Go to terminal 6',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo7': {
    key: '7',
    modifiers: ['alt'],
    description: 'Go to terminal 7',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo8': {
    key: '8',
    modifiers: ['alt'],
    description: 'Go to terminal 8',
    category: 'terminal',
    enabled: true,
  },
  'terminal.goTo9': {
    key: '9',
    modifiers: ['alt'],
    description: 'Go to terminal 9',
    category: 'terminal',
    enabled: true,
  },

  // File explorer
  'fileExplorer.toggle': {
    key: 'b',
    modifiers: ['ctrl'],
    description: 'Toggle file explorer',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.filesTab': {
    key: 'e',
    modifiers: ['ctrl', 'shift'],
    description: 'Switch to files tab',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.gitTab': {
    key: 'g',
    modifiers: ['ctrl', 'shift'],
    description: 'Switch to git tab',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.tasksTab': {
    key: 'k',
    modifiers: ['ctrl', 'shift'],
    description: 'Switch to tasks tab',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.newFile': {
    key: 'n',
    modifiers: ['ctrl', 'alt'],
    description: 'New file in file explorer',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.newFolder': {
    key: 'n',
    modifiers: ['ctrl', 'alt', 'shift'],
    description: 'New folder in file explorer',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.rename': {
    key: 'F2',
    modifiers: [],
    description: 'Rename selected file/folder',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.delete': {
    key: 'Delete',
    modifiers: [],
    description: 'Delete selected file/folder',
    category: 'file-explorer',
    enabled: true,
  },
  'fileExplorer.copyPath': {
    key: 'c',
    modifiers: ['ctrl', 'shift'],
    description: 'Copy file path',
    category: 'file-explorer',
    enabled: true,
  },

  // Editor
  'editor.closeTab': {
    key: 'w',
    modifiers: ['ctrl', 'shift'],
    description: 'Close active editor tab',
    category: 'editor',
    enabled: true,
  },
  'editor.nextTab': {
    key: 'Tab',
    modifiers: ['ctrl'],
    description: 'Next editor tab',
    category: 'editor',
    enabled: true,
  },
  'editor.previousTab': {
    key: 'Tab',
    modifiers: ['ctrl', 'shift'],
    description: 'Previous editor tab',
    category: 'editor',
    enabled: true,
  },
  'editor.save': {
    key: 's',
    modifiers: ['ctrl'],
    description: 'Save current file',
    category: 'editor',
    enabled: true,
  },

  // Worktree
  'worktree.create': {
    key: 'n',
    modifiers: ['ctrl', 'shift'],
    description: 'Create new worktree',
    category: 'worktree',
    enabled: true,
  },

  // Sidebar
  'sidebar.toggleInactive': {
    key: 'i',
    modifiers: ['ctrl', 'shift'],
    description: 'Toggle inactive projects section',
    category: 'sidebar',
    enabled: true,
  },

  // UI & Settings
  'ui.openSettings': {
    key: ',',
    modifiers: ['ctrl'],
    description: 'Open settings',
    category: 'ui',
    enabled: true,
  },
  'ui.toggleTheme': {
    key: 't',
    modifiers: ['ctrl', 'shift'],
    description: 'Toggle theme',
    category: 'ui',
    enabled: true,
  },
  'ui.showShortcuts': {
    key: '/',
    modifiers: ['ctrl'],
    description: 'Show keyboard shortcuts',
    category: 'ui',
    enabled: true,
  },

  // Dialogs
  'dialog.close': {
    key: 'Escape',
    modifiers: [],
    description: 'Close dialog',
    category: 'dialog',
    enabled: true,
  },
  'dialog.confirm': {
    key: 'Enter',
    modifiers: [],
    description: 'Confirm dialog',
    category: 'dialog',
    enabled: true,
  },
};

/**
 * Check if a keyboard event matches a hotkey binding
 */
export function matchesBinding(e: KeyboardEvent, binding: HotkeyBinding): boolean {
  if (!binding.enabled) return false;

  // Check modifiers
  const ctrlRequired = binding.modifiers.includes('ctrl');
  const altRequired = binding.modifiers.includes('alt');
  const shiftRequired = binding.modifiers.includes('shift');
  const metaRequired = binding.modifiers.includes('meta');

  // Support both Ctrl and Meta (Cmd on Mac) for 'ctrl' modifier
  const ctrlOrMeta = e.ctrlKey || e.metaKey;

  if (ctrlRequired && !ctrlOrMeta) return false;
  if (altRequired && !e.altKey) return false;
  if (shiftRequired && !e.shiftKey) return false;
  if (metaRequired && !e.metaKey) return false;

  // Check that no extra modifiers are pressed
  if (!ctrlRequired && e.ctrlKey && !metaRequired) return false;
  if (!altRequired && e.altKey) return false;
  if (!shiftRequired && e.shiftKey) return false;
  if (!metaRequired && e.metaKey && !ctrlRequired) return false;

  // Check key (case-insensitive for letters)
  const pressedKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const bindingKey = binding.key.length === 1 ? binding.key.toLowerCase() : binding.key;

  return pressedKey === bindingKey;
}

/**
 * Format a hotkey binding for display
 */
export function formatBinding(binding: HotkeyBinding): string {
  const parts: string[] = [];

  // Use platform-specific modifier names
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  if (binding.modifiers.includes('ctrl')) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (binding.modifiers.includes('alt')) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (binding.modifiers.includes('shift')) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (binding.modifiers.includes('meta')) {
    parts.push(isMac ? '⌘' : 'Win');
  }

  // Format key name for display
  let keyDisplay = binding.key;
  switch (binding.key) {
    case 'ArrowUp':
      keyDisplay = '↑';
      break;
    case 'ArrowDown':
      keyDisplay = '↓';
      break;
    case 'ArrowLeft':
      keyDisplay = '←';
      break;
    case 'ArrowRight':
      keyDisplay = '→';
      break;
    case 'Escape':
      keyDisplay = 'Esc';
      break;
    case 'Tab':
      keyDisplay = 'Tab';
      break;
    case 'Enter':
      keyDisplay = '↵';
      break;
    case 'Delete':
      keyDisplay = 'Del';
      break;
    case ' ':
      keyDisplay = 'Space';
      break;
    case '\\':
      keyDisplay = '\\';
      break;
    default:
      if (keyDisplay.length === 1) {
        keyDisplay = keyDisplay.toUpperCase();
      }
  }

  parts.push(keyDisplay);

  return isMac ? parts.join('') : parts.join(' + ');
}

/**
 * Check if two hotkey bindings conflict
 */
export function hasConflict(a: HotkeyBinding, b: HotkeyBinding): boolean {
  if (!a.enabled || !b.enabled) return false;

  // Check if keys match (case-insensitive for letters)
  const keyA = a.key.length === 1 ? a.key.toLowerCase() : a.key;
  const keyB = b.key.length === 1 ? b.key.toLowerCase() : b.key;
  if (keyA !== keyB) return false;

  // Check if modifiers match exactly
  const modsA = [...a.modifiers].sort();
  const modsB = [...b.modifiers].sort();

  if (modsA.length !== modsB.length) return false;

  return modsA.every((mod, i) => mod === modsB[i]);
}

/**
 * Find all hotkey actions that conflict with a given binding
 */
export function findConflicts(
  binding: HotkeyBinding,
  config: HotkeyConfig,
  excludeAction?: HotkeyAction
): HotkeyAction[] {
  const conflicts: HotkeyAction[] = [];

  for (const [action, existingBinding] of Object.entries(config)) {
    if (action === excludeAction) continue;
    if (hasConflict(binding, existingBinding)) {
      conflicts.push(action as HotkeyAction);
    }
  }

  return conflicts;
}

// Modifier-only keys that should be ignored when parsing key events
const MODIFIER_ONLY_KEYS = ['Control', 'Alt', 'Shift', 'Meta'] as const;

// Type guard to check if a key is a modifier-only key
function isModifierOnlyKey(key: string): key is (typeof MODIFIER_ONLY_KEYS)[number] {
  return (MODIFIER_ONLY_KEYS as readonly string[]).includes(key);
}

// Mapping from KeyboardEvent modifier flags to ModifierKey values
const MODIFIER_FLAG_MAP: ReadonlyArray<{ flag: keyof Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>; modifier: ModifierKey }> = [
  { flag: 'ctrlKey', modifier: 'ctrl' },
  { flag: 'altKey', modifier: 'alt' },
  { flag: 'shiftKey', modifier: 'shift' },
  { flag: 'metaKey', modifier: 'meta' },
];

/**
 * Parse a key event into a binding (for recording)
 */
export function parseKeyEvent(e: KeyboardEvent): Omit<HotkeyBinding, 'description' | 'category' | 'enabled'> | null {
  // Ignore modifier-only key presses using type guard
  if (isModifierOnlyKey(e.key)) {
    return null;
  }

  // Build modifiers array using type-safe mapping
  const modifiers = MODIFIER_FLAG_MAP
    .filter(({ flag }) => e[flag])
    .map(({ modifier }) => modifier);

  return {
    key: e.key,
    modifiers,
  };
}

/**
 * Get hotkey actions grouped by category
 */
export function getHotkeysByCategory(config: HotkeyConfig): Map<string, Array<{ action: HotkeyAction; binding: HotkeyBinding }>> {
  const grouped = new Map<string, Array<{ action: HotkeyAction; binding: HotkeyBinding }>>();

  for (const [action, binding] of Object.entries(config)) {
    const category = binding.category;
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push({ action: action as HotkeyAction, binding });
  }

  return grouped;
}
