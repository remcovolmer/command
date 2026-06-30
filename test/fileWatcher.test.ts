import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { isIgnoredPath } from '../electron/main/services/FileWatcherService'

const root = path.join('C:', 'Users', 'dev', 'command')
const p = (...segs: string[]) => path.join(root, ...segs)

describe('isIgnoredPath', () => {
  it('never ignores the watch root itself', () => {
    expect(isIgnoredPath(root, root)).toBe(false)
  })

  it('ignores node_modules and everything under it', () => {
    expect(isIgnoredPath(p('node_modules'), root)).toBe(true)
    expect(isIgnoredPath(p('node_modules', 'react', 'index.js'), root)).toBe(true)
  })

  it('ignores nested worktrees so a worktree-heavy project is not re-walked', () => {
    expect(isIgnoredPath(p('.worktrees'), root)).toBe(true)
    expect(isIgnoredPath(p('.worktrees', 'feat-x', 'src', 'App.tsx'), root)).toBe(true)
    // node_modules inside a worktree is doubly excluded — fine either way
    expect(isIgnoredPath(p('.worktrees', 'feat-x', 'node_modules', 'x.js'), root)).toBe(true)
  })

  it('ignores .git, dist, build, coverage and the rest', () => {
    expect(isIgnoredPath(p('.git', 'HEAD'), root)).toBe(true)
    expect(isIgnoredPath(p('dist', 'bundle.js'), root)).toBe(true)
    expect(isIgnoredPath(p('build', 'out.js'), root)).toBe(true)
    expect(isIgnoredPath(p('coverage', 'lcov.info'), root)).toBe(true)
    expect(isIgnoredPath(p('.next', 'cache'), root)).toBe(true)
    expect(isIgnoredPath(p('__pycache__', 'm.pyc'), root)).toBe(true)
    expect(isIgnoredPath(p('.venv', 'bin', 'python'), root)).toBe(true)
  })

  it('ignores log files and OS junk by basename', () => {
    expect(isIgnoredPath(p('src', 'debug.log'), root)).toBe(true)
    expect(isIgnoredPath(p('.DS_Store'), root)).toBe(true)
    expect(isIgnoredPath(p('assets', 'Thumbs.db'), root)).toBe(true)
  })

  it('watches normal source files', () => {
    expect(isIgnoredPath(p('src', 'App.tsx'), root)).toBe(false)
    expect(isIgnoredPath(p('electron', 'main', 'index.ts'), root)).toBe(false)
    expect(isIgnoredPath(p('docs', 'plans', 'x.md'), root)).toBe(false)
  })

  it('does not ignore based on a watch-root ancestor directory name', () => {
    // The project lives under a "build" ancestor; the project must still be watched.
    const buildRoot = path.join('C:', 'dev', 'build', 'myproject')
    expect(isIgnoredPath(path.join(buildRoot, 'src', 'index.ts'), buildRoot)).toBe(false)
    expect(isIgnoredPath(path.join(buildRoot, 'node_modules', 'x.js'), buildRoot)).toBe(true)
  })

  it('handles forward-slash separators (chokidar may emit them)', () => {
    expect(isIgnoredPath('/home/dev/command/node_modules/x.js', '/home/dev/command')).toBe(true)
    expect(isIgnoredPath('/home/dev/command/src/x.ts', '/home/dev/command')).toBe(false)
  })
})
