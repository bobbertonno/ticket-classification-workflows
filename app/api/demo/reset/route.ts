import { z } from 'zod'
import { resetDemo } from '@/lib/engine/seed'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, requireRole, route } from '@/lib/server/http'

export const maxDuration = 60

export const POST = route('/api/demo/reset', async (req) => {
  const { store, actor, env } = await getContext()
  requireRole(actor, ['admin'])
  await parseBody(req, z.object({ confirm: z.literal('RESET', { message: 'Conferma richiesta: digitare RESET' }) }))
  const counts = await resetDemo(store, actor.name)
  return ok({ environmentId: env.environmentId, counts })
})
