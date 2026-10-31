import { buildAgencyAnalytics } from '@/lib/engine/analytics'
import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'

export const GET = route('/api/analytics/agencies', async () => {
  const { store } = await getContext()
  return ok(await buildAgencyAnalytics(store))
})
