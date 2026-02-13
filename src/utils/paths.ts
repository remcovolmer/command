/** Get the parent directory path from a file path */
export function getParentPath(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  parts.pop()
  return parts.join(sep)
}
