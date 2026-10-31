import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingBlock } from '@/components/console/kit'
import { SettingsPage } from '@/components/pages/settings'

export const metadata: Metadata = { title: 'Impostazioni e integrazioni' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <SettingsPage />
    </Suspense>
  )
}
