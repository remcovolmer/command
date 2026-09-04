import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock electron's app module — mirrors test/projectPersistence.test.ts.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

const { fsMock } = vi.hoisted(() => ({
  fsMock: {
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}))

vi.mock('node:fs', () => ({
  default: fsMock,
}))

import { readUiStateSync, writeUiState, TITLEBAR_COLORS } from '../electron/main/services/uiState'

describe('uiState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.existsSync.mockReturnValue(true)
  })

  describe('readUiStateSync', () => {
    test('reads a valid persisted theme', () => {
      fsMock.readFileSync.mockReturnValue(JSON.stringify({ resolvedTheme: 'light' }))
      expect(readUiStateSync()).toEqual({ resolvedTheme: 'light' })
    })

    test('reads the other valid theme too', () => {
      fsMock.readFileSync.mockReturnValue(JSON.stringify({ resolvedTheme: 'dark' }))
      expect(readUiStateSync()).toEqual({ resolvedTheme: 'dark' })
    })

    test('defaults to dark when the file does not exist', () => {
      fsMock.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })
      expect(readUiStateSync()).toEqual({ resolvedTheme: 'dark' })
    })

    test('defaults to dark when the file contains invalid JSON', () => {
      fsMock.readFileSync.mockReturnValue('{not json')
      expect(readUiStateSync()).toEqual({ resolvedTheme: 'dark' })
    })

    test('defaults to dark when resolvedTheme is not a valid theme value', () => {
      fsMock.readFileSync.mockReturnValue(JSON.stringify({ resolvedTheme: 'purple' }))
      expect(readUiStateSync()).toEqual({ resolvedTheme: 'dark' })
    })

    test('defaults to dark when the parsed value is not an object', () => {
      fsMock.readFileSync.mockReturnValue(JSON.stringify('dark'))
      expect(readUiStateSync()).toEqual({ resolvedTheme: 'dark' })
    })
  })

  describe('writeUiState', () => {
    test('writes to a temp file and renames it atomically', () => {
      writeUiState({ resolvedTheme: 'light' })
      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/ui-state\.json\.tmp$/),
        JSON.stringify({ resolvedTheme: 'light' }, null, 2),
        'utf-8'
      )
      expect(fsMock.renameSync).toHaveBeenCalledWith(
        expect.stringMatching(/ui-state\.json\.tmp$/),
        expect.stringMatching(/ui-state\.json$/)
      )
    })

    test('creates the userData directory if missing', () => {
      fsMock.existsSync.mockReturnValue(false)
      writeUiState({ resolvedTheme: 'dark' })
      expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })

    test('swallows write errors instead of throwing', () => {
      fsMock.writeFileSync.mockImplementation(() => {
        throw new Error('disk full')
      })
      expect(() => writeUiState({ resolvedTheme: 'dark' })).not.toThrow()
    })
  })

  describe('TITLEBAR_COLORS', () => {
    test('defines a color and symbolColor for both themes', () => {
      expect(TITLEBAR_COLORS.light.color).toMatch(/^#/)
      expect(TITLEBAR_COLORS.light.symbolColor).toMatch(/^#/)
      expect(TITLEBAR_COLORS.dark.color).toMatch(/^#/)
      expect(TITLEBAR_COLORS.dark.symbolColor).toMatch(/^#/)
    })
  })
})
