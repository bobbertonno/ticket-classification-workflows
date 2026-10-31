import { z } from 'zod'
import { commentTask } from '@/lib/engine/engine'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, requireRole, route } from '@/lib/server/http'

export const POST = route<{ id: string }>('/api/human-tasks/[id]/comment', async (req, { params }) => {
  const { id } = await params
  const { actor, deps } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin', 'approver'])
  const { text } = await parseBody(req, z.object({ text: z.string().trim().min(1).max(1000) }))
  return ok({ task: await commentTask(deps, id, text, actor) })
})
