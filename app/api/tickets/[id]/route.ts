import { getContext } from '@/lib/server/context'
import { HttpError, ok, route } from '@/lib/server/http'
import { ticketDetail } from '@/lib/server/queries'

export const GET = route<{ id: string }>('/api/tickets/[id]', async (_req, { params }) => {
  const { id } = await params
  const { store } = await getContext()
  const detail = await ticketDetail(store, id)
  if (!detail) throw new HttpError(404, 'NOT_FOUND', `Ticket ${id} non trovato`)
  return ok(detail)
})
