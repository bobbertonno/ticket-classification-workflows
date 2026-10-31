import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TasksPage } from '@/components/pages/tasks'
import { LoadingBlock } from '@/components/console/kit'

export const metadata: Metadata = { title: 'Human Tasks' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <TasksPage />
    </Suspense>
  )
}
