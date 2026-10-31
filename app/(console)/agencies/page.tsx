import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { AgenciesPage } from '@/components/pages/agencies'

export const metadata: Metadata = { title: 'Performance agenzie' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <AgenciesPage />
    </Suspense>
  )
}
