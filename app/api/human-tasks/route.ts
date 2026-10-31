import { canDecide } from '@/lib/engine/engine'
import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'
import { listHumanTasks } from '@/lib/server/queries'

export const GET = route('/api/human-tasks', async (req) => {
  const { store, actor } = await getContext()
  const tasks = await listHumanTasks(store, new URL(req.url))
  return ok({ tasks: tasks.map((t) => ({ ...t, canDecide: canDecide(actor, t) })) })
})
