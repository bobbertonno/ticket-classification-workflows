import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { randomId } from '@/lib/domain/ids'
import { controlPlane } from './control-plane'
import { deriveKey, masterSecret } from './keys'

/**
 * Secret manager abstraction. Application records store only opaque references:
 *   env://NAME      → resolved from a server-side environment variable (Vercel encrypted env vars)
 *   sm://SECRET-ID  → AES-256-GCM envelope stored in the control-plane `secrets` collection
 * Swap `EncryptedSecretManager` for AWS Secrets Manager / Vault by implementing the same interface.
 */
export interface SecretManager {
  readonly persistent: boolean
  readonly description: string
  put(ownerId: string, plaintext: string, label: string): Promise<string>
  resolve(ref: string): Promise<string | null>
  revoke(ref: string): Promise<void>
}

export interface StoredSecret {
  secretId: string
  ownerId: string
  label: string
  iv: string
  tag: string
  ciphertext: string
  createdAt: string
  revokedAt: string | null
}

function encryptionKey(): { key: Buffer; persistent: boolean } {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (raw) {
    const key = Buffer.from(raw, 'base64')
    if (key.length === 32) return { key, persistent: true }
  }
  return { key: deriveKey('secret-manager'), persistent: masterSecret().stable }
}

class EncryptedSecretManager implements SecretManager {
  get persistent() {
    return encryptionKey().persistent && controlPlane().persistent
  }
  get description() {
    return this.persistent
      ? `AES-256-GCM con chiave derivata dal segreto server, archiviato in: ${controlPlane().description}`
      : 'AES-256-GCM con chiave effimera per processo (configurare SESSION_SECRET per la persistenza tra istanze)'
  }

  async put(ownerId: string, plaintext: string, label: string): Promise<string> {
    const { key } = encryptionKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const secretId = randomId('SEC')
    const record: StoredSecret = {
      secretId,
      ownerId,
      label,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    }
    await (await controlPlane().secrets()).insertOne(record)
    return `sm://${secretId}`
  }

  async resolve(ref: string): Promise<string | null> {
    if (ref.startsWith('env://')) return process.env[ref.slice(6)] ?? null
    if (!ref.startsWith('sm://')) return null
    const rec = await (await controlPlane().secrets()).findOne({ secretId: ref.slice(5) })
    if (!rec || rec.revokedAt) return null
    try {
      const { key } = encryptionKey()
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(rec.tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(rec.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  async revoke(ref: string): Promise<void> {
    if (!ref.startsWith('sm://')) return
    const col = await controlPlane().secrets()
    await col.updateOne({ secretId: ref.slice(5) }, { revokedAt: new Date().toISOString(), ciphertext: '', iv: '', tag: '' })
  }
}

let manager: SecretManager | null = null
export function secretManager(): SecretManager {
  manager ??= new EncryptedSecretManager()
  return manager
}
