import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { TicketsPage } from '@/components/pages/tickets'

export const metadata: Metadata = { title: 'Remedy Tickets' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <TicketsPage />
    </Suspense>
  )
}
