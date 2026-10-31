import { getContext } from '@/lib/server/context'
import { HttpError, ok, route } from '@/lib/server/http'

export const GET = route<{ ticketId: string }>('/api/classification/[ticketId]', async (_req, { params }) => {
  const { ticketId } = await params
  const { store } = await getContext()
  const ticket = await store.collection('remedy_tickets').findOne({ ticketId })
  if (!ticket) throw new HttpError(404, 'NOT_FOUND', `Ticket ${ticketId} non trovato`)
  const [results, agency] = await Promise.all([
    store.collection('classification_results').find({ ticketId }),
    store.collection('agencies').findOne({ agencyId: ticket.agencyId }),
  ])
  const sorted = results.sort((a, b) => b.classificationTimestamp.localeCompare(a.classificationTimestamp))
  return ok({ ticket, agency, classification: sorted[0] ?? null, history: sorted })
})
