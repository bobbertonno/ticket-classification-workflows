import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'
import { listAudit } from '@/lib/server/queries'

export const GET = route('/api/audit', async (req) => {
  const { store } = await getContext()
  return ok(await listAudit(store, new URL(req.url)))
})
