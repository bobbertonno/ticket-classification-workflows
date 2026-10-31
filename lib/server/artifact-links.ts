import 'server-only'
import { sign, verify } from './auth'

const TTL_MS = 15 * 60_000

/** Authorized, expiring download URL bound to artifact, environment and user. */
export function createDownloadUrl(artifactId: string, environmentId: string, userId: string): { url: string; expiresAt: string } {
  const exp = Date.now() + TTL_MS
  const token = sign(`${artifactId}|${environmentId}|${userId}|${exp}`)
  return { url: `/api/artifacts/${encodeURIComponent(artifactId)}/download?token=${encodeURIComponent(token)}`, expiresAt: new Date(exp).toISOString() }
}

export function verifyDownloadToken(token: string | null, artifactId: string, environmentId: string, userId: string): string | null {
  const value = verify(token ?? undefined)
  if (!value) return 'Link di download non valido'
  const [aid, env, uid, exp] = value.split('|')
  if (aid !== artifactId || env !== environmentId || uid !== userId) return 'Link non associato a questo utente o ambiente'
  if (Number(exp) < Date.now()) return 'Link di download scaduto: generarne uno nuovo'
  return null
}
