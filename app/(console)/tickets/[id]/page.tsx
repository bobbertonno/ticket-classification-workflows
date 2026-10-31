import type { Metadata } from 'next'
import { TicketDetailPage } from '@/components/pages/ticket-detail'

export const metadata: Metadata = { title: 'Dettaglio ticket' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <TicketDetailPage ticketId={decodeURIComponent(id)} />
}
