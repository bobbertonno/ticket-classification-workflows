import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'

export const GET = route('/api/agencies', async () => {
  const { store } = await getContext()
  const agencies = await store.collection('agencies').find({}, { sort: { field: 'agencyId', dir: 1 } })
  return ok({ agencies })
})
