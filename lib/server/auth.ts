import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import type { Actor } from '@/lib/engine/support'
import { deriveKey } from './keys'

/**
 * Demo identity layer: presenter personas with server-enforced roles carried in an HMAC-signed,
 * HttpOnly cookie. Replace `currentActor()` with your IdP (Entra ID / Okta via OIDC) in production.
 */
export const PERSONAS: (Actor & { email: string; description: string })[] = [
  { id: 'u-giulia', name: 'Giulia Romano', role: 'admin', team: 'Automation CoE', email: 'giulia.romano@demo.invalid', description: 'Presenter · amministratrice piattaforma' },
  { id: 'u-marco', name: 'Marco Bianchi', role: 'approver', team: 'Claims Operations', email: 'marco.bianchi@demo.invalid', description: 'Approvatore operativo' },
  { id: 'u-laura', name: 'Laura Conti', role: 'viewer', team: 'Internal Audit', email: 'laura.conti@demo.invalid', description: 'Sola lettura (audit)' },
]

export const USER_COOKIE = 'gacc_user'
export const ENV_COOKIE = 'gacc_env'

function key(): Buffer {
  return deriveKey('session-cookie')
}

export function sign(value: string): string {
  const mac = createHmac('sha256', key()).update(value).digest('base64url')
  return `${value}.${mac}`
}

export function verify(signed: string | undefined): string | null {
  if (!signed) return null
  const i = signed.lastIndexOf('.')
  if (i <= 0) return null
  const value = signed.slice(0, i)
  const expected = Buffer.from(sign(value).slice(i + 1))
  const actual = Buffer.from(signed.slice(i + 1))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return value
}

export async function currentActor(): Promise<Actor & { email: string; description: string }> {
  const jar = await cookies()
  const id = verify(jar.get(USER_COOKIE)?.value)
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
}

export async function selectedEnvironmentId(): Promise<string> {
  const jar = await cookies()
  return verify(jar.get(ENV_COOKIE)?.value) ?? 'demo'
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  // SameSite=None is required for the cookies to survive inside the cross-site v0 preview iframe.
  sameSite: 'none' as const,
  secure: true,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
}
