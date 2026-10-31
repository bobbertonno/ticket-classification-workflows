import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'
import { listTickets } from '@/lib/server/queries'

export const GET = route('/api/tickets', async (req) => {
  const { store } = await getContext()
  return ok({ tickets: await listTickets(store, new URL(req.url)) })
})
