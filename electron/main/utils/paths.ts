/**
 * Normalize a path to use forward slashes (cross-platform compatibility)
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}
