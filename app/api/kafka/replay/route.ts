import { z } from 'zod'
import { replayMessage } from '@/lib/engine/engine'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, requireRole, route } from '@/lib/server/http'

export const POST = route('/api/kafka/replay', async (req) => {
  const { actor, deps } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin'])
  const { eventId } = await parseBody(req, z.object({ eventId: z.string().min(4).max(80) }))
  return ok(await replayMessage(deps, eventId, actor))
})
