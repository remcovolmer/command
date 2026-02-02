/** Extension → Monaco language mapping. Also serves as the set of editable file types. */
export const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
  sql: 'sql',
  toml: 'ini',
  env: 'ini',
  gitignore: 'ini',
  txt: 'plaintext',
  csv: 'plaintext',
  svg: 'xml',
  lock: 'plaintext',
  conf: 'ini',
  cfg: 'ini',
  ini: 'ini',
  vue: 'html',
  svelte: 'html',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  php: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
}

export function getMonacoLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext'
}

export function isEditableFile(fileName: string, extension?: string): boolean {
  const ext = extension?.toLowerCase() ?? ''
  return ext in EXT_TO_LANGUAGE || fileName.startsWith('.')
}
