import type { Metadata } from 'next'
import { ExecutionsPage } from '@/components/pages/executions'

export const metadata: Metadata = { title: 'Live Executions' }

export default function Page() {
  return <ExecutionsPage />
}
