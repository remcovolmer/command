import type { ILinkProvider, ILink, IBufferRange, Terminal } from '@xterm/xterm'
import type { ElectronAPI } from '../types'

// Matches file paths with extensions, optionally followed by :line or :line:col
// Captures: relative paths (src/foo.ts), ./ paths, absolute Windows (C:\...) and Unix (/...) paths
const FILE_PATH_RE = /(?:(?:[a-zA-Z]:)?(?:[/\\][\w.@~-]+)+\.\w+)(?::(\d+)(?::(\d+))?)?/g

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
  projectId: string,
  api: ElectronAPI,
  openEditorTab: (filePath: string, fileName: string, projectId: string) => void,
): ILinkProvider {
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

      Promise.all(
        matches.map(async (m) => {
          const isAbsolute = /^[a-zA-Z]:[\\/]/.test(m.path) || m.path.startsWith('/')
          const fullPath = isAbsolute ? m.path : `${projectPath}/${m.path}`

          try {
            const stat = await api.fs.stat(fullPath)
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
                openEditorTab(stat.resolved, fileName, projectId)
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
      })
    },
  }
}
