import { z } from 'zod'
import { COOKIE_OPTIONS, ENV_COOKIE, currentActor, sign } from '@/lib/server/auth'
import { getEnvironment, toPublic } from '@/lib/server/control-plane'
import { HttpError, ok, parseBody, route } from '@/lib/server/http'

export const POST = route('/api/environments/select', async (req) => {
  const actor = await currentActor()
  const { environmentId } = await parseBody(req, z.object({ environmentId: z.string().min(1).max(60) }))
  const env = await getEnvironment(environmentId, actor.id)
  if (!env) throw new HttpError(404, 'ENV_NOT_FOUND', 'Ambiente non trovato o non accessibile')
  const res = ok({ environment: toPublic(env) })
  res.cookies.set(ENV_COOKIE, sign(env.environmentId), COOKIE_OPTIONS)
  return res
})
