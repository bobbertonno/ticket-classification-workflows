import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { WorkflowsPage } from '@/components/pages/workflows'

export const metadata: Metadata = { title: 'Workflow Catalog' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <WorkflowsPage />
    </Suspense>
  )
}
