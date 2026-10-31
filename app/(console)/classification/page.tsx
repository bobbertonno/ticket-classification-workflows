import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { ClassificationPage } from '@/components/pages/classification'

export const metadata: Metadata = { title: 'Classificazione semantica' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <ClassificationPage />
    </Suspense>
  )
}
