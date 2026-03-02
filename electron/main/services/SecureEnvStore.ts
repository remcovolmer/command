import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface EncryptedStore {
  [profileId: string]: { [key: string]: string }  // key -> base64-encrypted value
}

/**
 * Securely stores environment variables per profile using Electron's safeStorage (DPAPI on Windows).
 * Values are encrypted at rest and only decrypted when needed for PTY injection.
 */
export class SecureEnvStore {
  private filePath: string
  private store: EncryptedStore
  private hasWarnedFallback = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'secure-env.json')
    this.store = this.load()
  }

  private load(): EncryptedStore {
    try {
      const data = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as EncryptedStore
      }
    } catch {
      // File doesn't exist or is corrupted
    }
    return {}
  }

  private save(): void {
    try {
      const dirPath = path.dirname(this.filePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      const tempPath = `${this.filePath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(this.store, null, 2), 'utf-8')
      fs.renameSync(tempPath, this.filePath)
    } catch (error) {
      console.error('[SecureEnvStore] Failed to save:', error)
    }
  }

  /**
   * Encrypt and store env vars for a profile.
   */
  setEnvVars(profileId: string, vars: Record<string, string>): void {
    const encrypted: Record<string, string> = {}
    const useEncryption = safeStorage.isEncryptionAvailable()
    if (!useEncryption && !this.hasWarnedFallback) {
      console.warn('[SecureEnvStore] WARNING: safeStorage encryption not available. Values stored as base64 encoding only (not encrypted).')
      this.hasWarnedFallback = true
    }
    for (const [key, value] of Object.entries(vars)) {
      if (useEncryption) {
        encrypted[key] = safeStorage.encryptString(value).toString('base64')
      } else {
        encrypted[key] = Buffer.from(value).toString('base64')
      }
    }
    this.store[profileId] = encrypted
    this.save()
  }

  /**
   * Decrypt and return env vars for PTY injection. Only called in main process.
   */
  getEnvVars(profileId: string): Record<string, string> {
    const encrypted = this.store[profileId]
    if (!encrypted) return {}

    const decrypted: Record<string, string> = {}
    const useEncryption = safeStorage.isEncryptionAvailable()
    for (const [key, encValue] of Object.entries(encrypted)) {
      try {
        if (useEncryption) {
          decrypted[key] = safeStorage.decryptString(Buffer.from(encValue, 'base64'))
        } else {
          decrypted[key] = Buffer.from(encValue, 'base64').toString()
        }
      } catch (error) {
        console.error(`[SecureEnvStore] Failed to decrypt ${key}:`, error)
      }
    }
    return decrypted
  }

  /**
   * Delete all env vars for a profile.
   */
  deleteEnvVars(profileId: string): void {
    delete this.store[profileId]
    this.save()
  }

  /**
   * Return only the key names (no values) for renderer display.
   */
  getEnvVarKeys(profileId: string): string[] {
    const encrypted = this.store[profileId]
    if (!encrypted) return []
    return Object.keys(encrypted)
  }

  /**
   * Return the count of env vars for a profile (for AccountProfile.envVarCount).
   */
  getEnvVarCount(profileId: string): number {
    return this.getEnvVarKeys(profileId).length
  }
}
