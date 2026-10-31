import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'
import { listExecutions } from '@/lib/server/queries'

export const GET = route('/api/executions', async (req) => {
  const { store } = await getContext()
  return ok({ executions: await listExecutions(store, new URL(req.url)) })
})
