import { describe, test, expect, vi, beforeEach } from 'vitest'

let mockEncryptionAvailable = true
const mockEncryptString = vi.fn((value: string) => Buffer.from(`enc:${value}`))
const mockDecryptString = vi.fn((buf: Buffer) => {
  const str = buf.toString()
  if (!str.startsWith('enc:')) throw new Error('Invalid encrypted data')
  return str.slice(4)
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
  safeStorage: {
    isEncryptionAvailable: () => mockEncryptionAvailable,
    encryptString: (value: string) => mockEncryptString(value),
    decryptString: (buf: Buffer) => mockDecryptString(buf),
  },
}))

let mockFileContents: string | null = null
const mockWriteFileSync = vi.fn()
const mockRenameSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockExistsSync = vi.fn(() => true)
const mockMkdirSync = vi.fn()

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(() => {
      if (mockFileContents === null) throw new Error('ENOENT')
      return mockFileContents
    }),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    renameSync: (...args: unknown[]) => mockRenameSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  },
}))

import { SecureEnvStore } from '../electron/main/services/SecureEnvStore'

describe('SecureEnvStore', () => {
  beforeEach(() => {
    mockEncryptionAvailable = true
    mockFileContents = null
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
  })

  function createStore(fileContents?: string): SecureEnvStore {
    if (fileContents !== undefined) mockFileContents = fileContents
    return new SecureEnvStore()
  }

  describe('round-trip encrypt/decrypt', () => {
    test('stores and retrieves env vars with encryption', () => {
      const store = createStore()
      store.setEnvVars('profile-1', { API_KEY: 'secret123', TOKEN: 'abc' })

      const result = store.getEnvVars('profile-1')
      expect(result).toEqual({ API_KEY: 'secret123', TOKEN: 'abc' })
    })

    test('stores and retrieves env vars without encryption (base64 fallback)', () => {
      mockEncryptionAvailable = false
      const store = createStore()
      store.setEnvVars('profile-1', { API_KEY: 'secret123' })

      const result = store.getEnvVars('profile-1')
      expect(result).toEqual({ API_KEY: 'secret123' })
      expect(mockEncryptString).not.toHaveBeenCalled()
      expect(mockDecryptString).not.toHaveBeenCalled()
    })
  })

  describe('encryption mode mismatch (the core bug fix)', () => {
    test('reads base64 values correctly even when encryption becomes available', () => {
      mockEncryptionAvailable = false
      const store = createStore()
      store.setEnvVars('profile-1', { API_KEY: 'secret123' })

      mockEncryptionAvailable = true
      const result = store.getEnvVars('profile-1')
      expect(result).toEqual({ API_KEY: 'secret123' })
      expect(mockDecryptString).not.toHaveBeenCalled()
    })

    test('reads encrypted values correctly even when encryption becomes unavailable', () => {
      mockEncryptionAvailable = true
      const store = createStore()
      store.setEnvVars('profile-1', { API_KEY: 'secret123' })

      mockEncryptionAvailable = false
      const result = store.getEnvVars('profile-1')
      expect(result).toEqual({ API_KEY: 'secret123' })
      expect(mockDecryptString).toHaveBeenCalled()
    })
  })

  describe('migration from legacy format (no _meta key)', () => {
    test('migrates legacy entries assuming encrypted=true', () => {
      const legacyData = {
        'profile-1': {
          API_KEY: Buffer.from('enc:secret123').toString('base64'),
        },
      }
      const store = createStore(JSON.stringify(legacyData))
      const result = store.getEnvVars('profile-1')
      expect(result).toEqual({ API_KEY: 'secret123' })
    })
  })

  describe('getEnvVarKeys', () => {
    test('returns only data keys, excludes _meta', () => {
      const store = createStore()
      store.setEnvVars('profile-1', { API_KEY: 'x', TOKEN: 'y' })
      const keys = store.getEnvVarKeys('profile-1')
      expect(keys).toEqual(['API_KEY', 'TOKEN'])
      expect(keys).not.toContain('_meta')
    })

    test('returns empty array for unknown profile', () => {
      const store = createStore()
      expect(store.getEnvVarKeys('nonexistent')).toEqual([])
    })
  })

  describe('getEnvVarCount', () => {
    test('returns correct count excluding metadata', () => {
      const store = createStore()
      store.setEnvVars('profile-1', { A: '1', B: '2', C: '3' })
      expect(store.getEnvVarCount('profile-1')).toBe(3)
    })
  })

  describe('deleteEnvVars', () => {
    test('removes profile entry and persists', () => {
      const store = createStore()
      store.setEnvVars('profile-1', { API_KEY: 'x' })
      store.deleteEnvVars('profile-1')
      expect(store.getEnvVars('profile-1')).toEqual({})
      expect(store.getEnvVarKeys('profile-1')).toEqual([])
    })
  })

  describe('save() error handling', () => {
    test('propagates save errors to caller', () => {
      const store = createStore()
      mockRenameSync.mockImplementationOnce(() => { throw new Error('EPERM') })

      expect(() => store.setEnvVars('p1', { K: 'v' })).toThrow('EPERM')
    })

    test('cleans up temp file on rename failure', () => {
      const store = createStore()
      mockRenameSync.mockImplementationOnce(() => { throw new Error('EPERM') })

      try { store.setEnvVars('p1', { K: 'v' }) } catch { /* expected */ }
      expect(mockUnlinkSync).toHaveBeenCalled()
    })
  })

  describe('temp file cleanup on startup', () => {
    test('removes orphaned .tmp file during construction', () => {
      mockExistsSync.mockReturnValue(true)
      createStore()
      expect(mockUnlinkSync).toHaveBeenCalled()
    })
  })

  describe('error logging', () => {
    test('does not log env var key names on decryption failure', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockDecryptString.mockImplementationOnce(() => { throw new Error('corrupt') })

      const store = createStore()
      store.setEnvVars('profile-1', { SECRET_API_KEY: 'value' })
      store.getEnvVars('profile-1')

      for (const call of consoleSpy.mock.calls) {
        const msg = String(call[0])
        expect(msg).not.toContain('SECRET_API_KEY')
      }
      consoleSpy.mockRestore()
    })
  })
})
