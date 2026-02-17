/** Get the parent directory path from a file path */
export function getParentPath(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  parts.pop()
  return parts.join(sep)
}

/** Compare two file paths for equality, normalizing separators and case (Windows) */
export function pathsMatch(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  return normalize(a) === normalize(b)
}
