import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const METADATA_KEY = '_meta'

interface ProfileEntry {
  _meta: { encrypted: boolean }
  [key: string]: string | { encrypted: boolean }
}

interface EncryptedStore {
  [profileId: string]: ProfileEntry
}

export class SecureEnvStore {
  private filePath: string
  private store: EncryptedStore
  private hasWarnedFallback = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'secure-env.json')
    this.cleanupTempFile()
    this.store = this.load()
  }

  private cleanupTempFile(): void {
    try {
      const tempPath = `${this.filePath}.tmp`
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private load(): EncryptedStore {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return this.migrateStore(parsed)
      }
    } catch {
      // File doesn't exist or is corrupted
    }
    return {}
  }

  private migrateStore(raw: Record<string, Record<string, string>>): EncryptedStore {
    const migrated: EncryptedStore = {}
    for (const [profileId, entries] of Object.entries(raw)) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
      if (entries[METADATA_KEY] && typeof entries[METADATA_KEY] === 'object') {
        migrated[profileId] = entries as unknown as ProfileEntry
      } else {
        migrated[profileId] = {
          [METADATA_KEY]: { encrypted: true },
          ...entries,
        } as ProfileEntry
      }
    }
    return migrated
  }

  private save(): void {
    const dirPath = path.dirname(this.filePath)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    const tempPath = `${this.filePath}.tmp`
    try {
      fs.writeFileSync(tempPath, JSON.stringify(this.store, null, 2), 'utf-8')
      fs.renameSync(tempPath, this.filePath)
    } catch (error) {
      try { fs.unlinkSync(tempPath) } catch { /* best-effort */ }
      console.error('[SecureEnvStore] Failed to save:', error)
      throw error
    }
  }

  setEnvVars(profileId: string, vars: Record<string, string>): void {
    const useEncryption = safeStorage.isEncryptionAvailable()
    if (!useEncryption && !this.hasWarnedFallback) {
      console.warn('[SecureEnvStore] WARNING: safeStorage encryption not available. Values stored as base64 encoding only (not encrypted).')
      this.hasWarnedFallback = true
    }

    const entry: ProfileEntry = {
      [METADATA_KEY]: { encrypted: useEncryption },
    } as ProfileEntry

    for (const [key, value] of Object.entries(vars)) {
      if (useEncryption) {
        (entry as Record<string, string | { encrypted: boolean }>)[key] = safeStorage.encryptString(value).toString('base64')
      } else {
        (entry as Record<string, string | { encrypted: boolean }>)[key] = Buffer.from(value).toString('base64')
      }
    }

    this.store[profileId] = entry
    this.save()
  }

  getEnvVars(profileId: string): Record<string, string> {
    const entry = this.store[profileId]
    if (!entry) return {}

    const meta = entry[METADATA_KEY]
    const wasEncrypted = meta?.encrypted ?? true

    const decrypted: Record<string, string> = {}
    for (const [key, encValue] of Object.entries(entry)) {
      if (key === METADATA_KEY) continue
      if (typeof encValue !== 'string') continue
      try {
        if (wasEncrypted) {
          decrypted[key] = safeStorage.decryptString(Buffer.from(encValue, 'base64'))
        } else {
          decrypted[key] = Buffer.from(encValue, 'base64').toString()
        }
      } catch {
        console.error('[SecureEnvStore] Failed to decrypt env var for profile')
      }
    }
    return decrypted
  }

  deleteEnvVars(profileId: string): void {
    delete this.store[profileId]
    this.save()
  }

  getEnvVarKeys(profileId: string): string[] {
    const entry = this.store[profileId]
    if (!entry) return []
    return Object.keys(entry).filter(k => k !== METADATA_KEY)
  }

  getEnvVarCount(profileId: string): number {
    return this.getEnvVarKeys(profileId).length
  }
}
