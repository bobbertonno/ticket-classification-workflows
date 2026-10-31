import { SimulatedRetriever } from '@/lib/classification/retriever'
import type { EngineDeps } from '@/lib/engine/engine'
import { seedDatabase } from '@/lib/engine/seed'
import type { Actor } from '@/lib/engine/support'
import { MemoryStore } from '@/lib/store/memory-store'

export const presenter: Actor = { id: 'u-admin', name: 'Presenter', role: 'admin', team: 'Automation CoE' }
export const approver: Actor = { id: 'u-appr', name: 'Approver', role: 'approver', team: 'Back Office Sinistri' }
export const viewer: Actor = { id: 'u-view', name: 'Viewer', role: 'viewer', team: 'Audit' }

export async function freshDeps(): Promise<EngineDeps> {
  const store = new MemoryStore()
  await seedDatabase(store, 'small')
  await store.collection('app_settings').updateOne({ key: 'app' }, { simulationSpeed: 'instant', paused: false, injectFailureNext: false })
  return { store, retriever: new SimulatedRetriever(store) }
}
