import type { ILinkProvider, ILink, IBufferRange, Terminal } from '@xterm/xterm'
import type { ElectronAPI } from '../types'

// Matches file paths with extensions, optionally followed by :line or :line:col
// Captures: relative paths (src/foo.ts), ./ paths, absolute Windows (C:\...) and Unix (/...) paths
const FILE_PATH_RE = /(?:(?:[a-zA-Z]:)?(?:[/\\][\w.@~-]+)+\.\w+)(?::\d+(?::\d+)?)?/g

function extractFileMatches(line: string): { path: string; start: number; end: number }[] {
  const matches: { path: string; start: number; end: number }[] = []
  FILE_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_PATH_RE.exec(line)) !== null) {
    const fullMatch = match[0]
    // Strip trailing :line:col from the path for the file lookup
    const pathOnly = fullMatch.replace(/:\d+(?::\d+)?$/, '')
    matches.push({
      path: pathOnly,
      start: match.index,
      end: match.index + fullMatch.length,
    })
  }
  return matches
}

export function createFileLinkProvider(
  terminal: Terminal,
  projectPath: string,
  api: ElectronAPI,
  openFile: (filePath: string, fileName: string) => void,
): ILinkProvider {
  // Cache stat results to avoid redundant IPC calls across provideLinks invocations.
  // Uses a max-size cap of 200 entries; oldest entries are evicted when the cap is reached.
  const statCache = new Map<string, Promise<{ exists: boolean; isFile: boolean; resolved: string }>>()
  const CACHE_MAX_SIZE = 200

  function cachedStat(fullPath: string): Promise<{ exists: boolean; isFile: boolean; resolved: string }> {
    const cached = statCache.get(fullPath)
    if (cached) return cached
    if (statCache.size >= CACHE_MAX_SIZE) {
      // Evict the oldest entry (first key in insertion order)
      const firstKey = statCache.keys().next().value
      if (firstKey !== undefined) statCache.delete(firstKey)
    }
    const promise = api.fs.stat(fullPath)
    statCache.set(fullPath, promise)
    return promise
  }

  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) {
        callback(undefined)
        return
      }

      const lineText = line.translateToString()
      const matches = extractFileMatches(lineText)
      if (matches.length === 0) {
        callback(undefined)
        return
      }

      // Cap to 10 matches per line to limit IPC stat calls
      const cappedMatches = matches.slice(0, 10)

      Promise.all(
        cappedMatches.map(async (m) => {
          const isAbsolute = /^[a-zA-Z]:[\\/]/.test(m.path) || m.path.startsWith('/')
          const fullPath = isAbsolute ? m.path : `${projectPath}/${m.path}`

          try {
            const stat = await cachedStat(fullPath)
            if (!stat.exists || !stat.isFile) return null

            const range: IBufferRange = {
              start: { x: m.start + 1, y: bufferLineNumber },
              end: { x: m.end + 1, y: bufferLineNumber },
            }

            const fileName = m.path.split(/[/\\]/).pop() || m.path

            const link: ILink = {
              range,
              text: lineText.substring(m.start, m.end),
              activate: () => {
                openFile(stat.resolved, fileName)
              },
            }
            return link
          } catch {
            return null
          }
        }),
      ).then((results) => {
        const links = results.filter((r): r is ILink => r !== null)
        callback(links.length > 0 ? links : undefined)
      }).catch(() => { callback(undefined) })
    },
  }
}
