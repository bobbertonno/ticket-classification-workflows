import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'
import { listNotifications } from '@/lib/server/queries'

export const GET = route('/api/notifications', async (req) => {
  const { store } = await getContext()
  return ok({ notifications: await listNotifications(store, new URL(req.url)) })
})
