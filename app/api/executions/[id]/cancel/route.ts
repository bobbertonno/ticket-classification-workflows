import { z } from 'zod'
import { cancelInstance } from '@/lib/engine/engine'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, requireRole, route } from '@/lib/server/http'

export const POST = route<{ id: string }>('/api/executions/[id]/cancel', async (req, { params }) => {
  const { id } = await params
  const { actor, deps } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin'])
  const { reason } = await parseBody(req, z.object({ reason: z.string().max(500).default('') }).default({ reason: '' }))
  return ok({ instance: await cancelInstance(deps, id, actor, reason) })
})
