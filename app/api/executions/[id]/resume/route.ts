import { resumeInstance } from '@/lib/engine/engine'
import { getContext } from '@/lib/server/context'
import { ok, requireRole, route } from '@/lib/server/http'

export const POST = route<{ id: string }>('/api/executions/[id]/resume', async (_req, { params }) => {
  const { id } = await params
  const { actor, deps } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin', 'approver'])
  return ok({ instance: await resumeInstance(deps, id, actor) })
})
