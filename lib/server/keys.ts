import 'server-only'
import { hkdfSync, randomBytes } from 'node:crypto'

const g = globalThis as unknown as { __gaccEphemeralMaster?: Buffer }

/**
 * Server master secret. SESSION_SECRET (any random string, >= 16 chars) makes keys stable across
 * serverless instances and restarts; without it a per-process ephemeral key is used.
 */
export function masterSecret(): { secret: Buffer; stable: boolean } {
  const raw = process.env.SESSION_SECRET ?? process.env.SECRETS_ENCRYPTION_KEY
  if (raw && raw.length >= 16) return { secret: Buffer.from(raw), stable: true }
  g.__gaccEphemeralMaster ??= randomBytes(32)
  return { secret: g.__gaccEphemeralMaster, stable: false }
}

export function deriveKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterSecret().secret, 'gacc-v1', purpose, 32))
}
