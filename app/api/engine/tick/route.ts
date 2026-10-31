import { z } from 'zod'
import { tick } from '@/lib/engine/engine'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, route } from '@/lib/server/http'

export const maxDuration = 30

/**
 * Server-side execution tick. The open UI calls this periodically (heartbeat) so
 * persisted workflow instances advance without long-running processes in Vercel functions.
 * Production replacement: a Temporal / Inngest / Vercel Workflow worker invoking `executeStep`.
 */
export const POST = route('/api/engine/tick', async (req) => {
  const { deps } = await getContext({ requireInitialized: true })
  const body = await parseBody(req, z.object({ instanceId: z.string().optional() }).default({}))
  return ok(await tick(deps, { instanceId: body.instanceId, limit: 10 }))
})
