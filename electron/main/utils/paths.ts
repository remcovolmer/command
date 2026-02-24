/**
 * Normalize a path for consistent comparison:
 * - Convert backslashes to forward slashes
 * - Remove trailing slash (except root like C:/)
 * - On Windows: lowercase entire path (NTFS is case-insensitive)
 */
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/')
  // Remove trailing slash (except root like C:/)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  // Windows: NTFS is case-insensitive, normalize to lowercase
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase()
  }
  return normalized
}
