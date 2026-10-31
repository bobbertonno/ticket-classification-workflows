import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { SetupWizard } from '@/components/pages/setup-wizard'

export const metadata: Metadata = { title: 'Setup Wizard' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <SetupWizard />
    </Suspense>
  )
}
