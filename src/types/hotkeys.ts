// Modifier keys
export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta';

// Hotkey categories for grouping in settings UI
export type HotkeyCategory =
  | 'navigation'
  | 'terminal'
  | 'file-explorer'
  | 'editor'
  | 'worktree'
  | 'sidebar'
  | 'ui'
  | 'dialog';

// Hotkey binding configuration
export interface HotkeyBinding {
  key: string;
  modifiers: ModifierKey[];
  description: string;
  category: HotkeyCategory;
  enabled: boolean;
}

// All available hotkey actions
export type HotkeyAction =
  // Navigation
  | 'nav.previousProject'
  | 'nav.nextProject'
  | 'nav.previousTerminal'
  | 'nav.nextTerminal'
  | 'nav.focusSidebar'
  | 'nav.focusTerminal'
  | 'nav.focusFileExplorer'
  // Terminal operations
  | 'terminal.new'
  | 'terminal.close'
  | 'terminal.split'
  | 'terminal.unsplit'
  | 'terminal.goTo1'
  | 'terminal.goTo2'
  | 'terminal.goTo3'
  | 'terminal.goTo4'
  | 'terminal.goTo5'
  | 'terminal.goTo6'
  | 'terminal.goTo7'
  | 'terminal.goTo8'
  | 'terminal.goTo9'
  // File explorer
  | 'fileExplorer.toggle'
  | 'fileExplorer.filesTab'
  | 'fileExplorer.gitTab'
  | 'fileExplorer.tasksTab'
  | 'fileExplorer.newFile'
  | 'fileExplorer.newFolder'
  | 'fileExplorer.rename'
  | 'fileExplorer.delete'
  | 'fileExplorer.copyPath'
  // Editor
  | 'editor.closeTab'
  | 'editor.nextTab'
  | 'editor.previousTab'
  | 'editor.save'
  // Worktree
  | 'worktree.create'
  // Sidebar
  | 'sidebar.toggleInactive'
  // UI & Settings
  | 'ui.openSettings'
  | 'ui.toggleTheme'
  | 'ui.showShortcuts'
  // Dialogs
  | 'dialog.close'
  | 'dialog.confirm';

// Complete hotkey configuration
export type HotkeyConfig = Record<HotkeyAction, HotkeyBinding>;

// Category display names
export const HOTKEY_CATEGORY_NAMES: Record<HotkeyCategory, string> = {
  navigation: 'Navigation',
  terminal: 'Terminal',
  'file-explorer': 'File Explorer',
  editor: 'Editor',
  worktree: 'Worktree',
  sidebar: 'Sidebar',
  ui: 'UI & Settings',
  dialog: 'Dialogs',
};

// Category order for display
export const HOTKEY_CATEGORY_ORDER: HotkeyCategory[] = [
  'navigation',
  'terminal',
  'file-explorer',
  'editor',
  'worktree',
  'sidebar',
  'ui',
  'dialog',
];
