import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  Folder,
  FolderOpen,
  FileType,
  FileVideo,
  FileAudio,
  Database,
  Settings,
  Package,
  Globe,
  Terminal,
  FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react'

export interface IconConfig {
  icon: LucideIcon
  color: string
}

// Extension to icon mapping
const FILE_ICONS: Record<string, IconConfig> = {
  // JavaScript/TypeScript
  js: { icon: FileCode, color: '#f7df1e' },
  jsx: { icon: FileCode, color: '#61dafb' },
  ts: { icon: FileCode, color: '#3178c6' },
  tsx: { icon: FileCode, color: '#3178c6' },
  mjs: { icon: FileCode, color: '#f7df1e' },
  cjs: { icon: FileCode, color: '#f7df1e' },

  // Web
  html: { icon: Globe, color: '#e34f26' },
  css: { icon: FileCode, color: '#1572b6' },
  scss: { icon: FileCode, color: '#cc6699' },
  sass: { icon: FileCode, color: '#cc6699' },
  less: { icon: FileCode, color: '#1d365d' },

  // Data/Config
  json: { icon: FileJson, color: '#cbcb41' },
  yaml: { icon: Settings, color: '#cb171e' },
  yml: { icon: Settings, color: '#cb171e' },
  toml: { icon: Settings, color: '#9c4121' },
  xml: { icon: FileCode, color: '#e37933' },
  env: { icon: Settings, color: '#ecd53f' },

  // Documents
  md: { icon: FileText, color: '#519aba' },
  mdx: { icon: FileText, color: '#519aba' },
  txt: { icon: FileText, color: '#89e051' },
  pdf: { icon: FileText, color: '#f40f02' },

  // Images
  png: { icon: FileImage, color: '#a074c4' },
  jpg: { icon: FileImage, color: '#a074c4' },
  jpeg: { icon: FileImage, color: '#a074c4' },
  gif: { icon: FileImage, color: '#a074c4' },
  svg: { icon: FileImage, color: '#ffb13b' },
  webp: { icon: FileImage, color: '#a074c4' },
  ico: { icon: FileImage, color: '#a074c4' },

  // Media
  mp4: { icon: FileVideo, color: '#fd971f' },
  webm: { icon: FileVideo, color: '#fd971f' },
  mp3: { icon: FileAudio, color: '#00acd7' },
  wav: { icon: FileAudio, color: '#00acd7' },
  ogg: { icon: FileAudio, color: '#00acd7' },

  // Database
  sql: { icon: Database, color: '#e38c00' },
  sqlite: { icon: Database, color: '#0f80cc' },
  db: { icon: Database, color: '#0f80cc' },

  // Package managers
  lock: { icon: Package, color: '#8bc500' },

  // Shell
  sh: { icon: Terminal, color: '#4eaa25' },
  bash: { icon: Terminal, color: '#4eaa25' },
  zsh: { icon: Terminal, color: '#4eaa25' },
  ps1: { icon: Terminal, color: '#5391fe' },
  bat: { icon: Terminal, color: '#c1f12e' },
  cmd: { icon: Terminal, color: '#c1f12e' },

  // Spreadsheets
  csv: { icon: FileSpreadsheet, color: '#89e051' },
  xlsx: { icon: FileSpreadsheet, color: '#107c41' },
  xls: { icon: FileSpreadsheet, color: '#107c41' },

  // Fonts
  ttf: { icon: FileType, color: '#ec6e4c' },
  otf: { icon: FileType, color: '#ec6e4c' },
  woff: { icon: FileType, color: '#ec6e4c' },
  woff2: { icon: FileType, color: '#ec6e4c' },
}

// Special filename mappings (take precedence over extension)
const SPECIAL_FILES: Record<string, IconConfig> = {
  'package.json': { icon: Package, color: '#e8274b' },
  'package-lock.json': { icon: Package, color: '#8bc500' },
  'yarn.lock': { icon: Package, color: '#2c8ebb' },
  'pnpm-lock.yaml': { icon: Package, color: '#f69220' },
  'tsconfig.json': { icon: Settings, color: '#3178c6' },
  'jsconfig.json': { icon: Settings, color: '#f7df1e' },
  'vite.config.ts': { icon: Settings, color: '#646cff' },
  'vite.config.js': { icon: Settings, color: '#646cff' },
  'tailwind.config.js': { icon: Settings, color: '#06b6d4' },
  'tailwind.config.ts': { icon: Settings, color: '#06b6d4' },
  'postcss.config.js': { icon: Settings, color: '#dd3a0a' },
  'eslint.config.js': { icon: Settings, color: '#4b32c3' },
  '.eslintrc': { icon: Settings, color: '#4b32c3' },
  '.eslintrc.js': { icon: Settings, color: '#4b32c3' },
  '.eslintrc.json': { icon: Settings, color: '#4b32c3' },
  '.prettierrc': { icon: Settings, color: '#56b3b4' },
  '.prettierrc.json': { icon: Settings, color: '#56b3b4' },
  'dockerfile': { icon: FileCode, color: '#2496ed' },
  'docker-compose.yml': { icon: FileCode, color: '#2496ed' },
  'docker-compose.yaml': { icon: FileCode, color: '#2496ed' },
  '.dockerignore': { icon: Settings, color: '#2496ed' },
  '.gitignore': { icon: Settings, color: '#f05032' },
  '.gitattributes': { icon: Settings, color: '#f05032' },
  'readme.md': { icon: FileText, color: '#519aba' },
  'license': { icon: FileText, color: '#d9bf42' },
  'license.md': { icon: FileText, color: '#d9bf42' },
}

// Default icons
const DEFAULT_FILE: IconConfig = { icon: File, color: '#8b8b8b' }
const FOLDER_CLOSED: IconConfig = { icon: Folder, color: '#dcb67a' }
const FOLDER_OPEN: IconConfig = { icon: FolderOpen, color: '#dcb67a' }

export function getFileIcon(name: string, extension?: string): IconConfig {
  // Check special filenames first (case-insensitive)
  const lowerName = name.toLowerCase()
  if (SPECIAL_FILES[lowerName]) {
    return SPECIAL_FILES[lowerName]
  }

  // Then check extension
  if (extension && FILE_ICONS[extension]) {
    return FILE_ICONS[extension]
  }

  return DEFAULT_FILE
}

export function getFolderIcon(isOpen: boolean): IconConfig {
  return isOpen ? FOLDER_OPEN : FOLDER_CLOSED
}
