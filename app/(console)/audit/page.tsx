import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { AuditPage } from '@/components/pages/audit'

export const metadata: Metadata = { title: 'Audit & Analytics' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <AuditPage />
    </Suspense>
  )
}
