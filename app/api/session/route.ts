import { NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_OPTIONS, PERSONAS, USER_COOKIE, currentActor, sign } from '@/lib/server/auth'
import { listEnvironments, toPublic } from '@/lib/server/control-plane'
import { getContext, platformInfo } from '@/lib/server/context'
import { getSettings } from '@/lib/engine/support'
import { ok, parseBody, route } from '@/lib/server/http'

export const GET = route('/api/session', async () => {
  const actor = await currentActor()
  const environments = (await listEnvironments(actor.id)).map(toPublic)
  let integration = null
  let settings = null
  let contextError: { code: string; message: string } | null = null
  try {
    const ctx = await getContext()
    integration = ctx.integration
    settings = await getSettings(ctx.store)
  } catch (err) {
    contextError = { code: (err as { code?: string }).code ?? 'ERROR', message: (err as Error).message }
  }
  return ok({ actor, personas: PERSONAS, environments, integration, settings, contextError, platform: platformInfo() })
})

export const POST = route('/api/session', async (req) => {
  const { userId } = await parseBody(req, z.object({ userId: z.string() }))
  const persona = PERSONAS.find((p) => p.id === userId)
  if (!persona) return NextResponse.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Utente demo non trovato' } }, { status: 404 })
  const res = ok({ actor: persona })
  res.cookies.set(USER_COOKIE, sign(persona.id), COOKIE_OPTIONS)
  return res
})
