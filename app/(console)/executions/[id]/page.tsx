import type { Metadata } from 'next'
import { ExecutionDetailPage } from '@/components/pages/execution-detail'

export const metadata: Metadata = { title: 'Dettaglio esecuzione' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ExecutionDetailPage instanceId={decodeURIComponent(id)} />
}
