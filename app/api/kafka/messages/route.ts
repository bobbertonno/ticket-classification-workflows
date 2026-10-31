import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'
import { kafkaOverview } from '@/lib/server/queries'

export const GET = route('/api/kafka/messages', async (req) => {
  const { store } = await getContext()
  return ok(await kafkaOverview(store, new URL(req.url)))
})
