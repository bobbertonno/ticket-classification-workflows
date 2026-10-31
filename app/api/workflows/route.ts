import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'

export const GET = route('/api/workflows', async () => {
  const { store } = await getContext()
  const [workflows, instances] = await Promise.all([
    store.collection('workflow_definitions').find({}, { sort: { field: 'workflowId', dir: 1 } }),
    store.collection('workflow_instances').find(),
  ])
  const usage = new Map<string, { total: number; completed: number; failed: number }>()
  for (const i of instances) {
    const u = usage.get(i.workflowId) ?? { total: 0, completed: 0, failed: 0 }
    u.total++
    if (i.status === 'COMPLETED') u.completed++
    if (i.status === 'FAILED') u.failed++
    usage.set(i.workflowId, u)
  }
  return ok({ workflows: workflows.map((w) => ({ ...w, usage: usage.get(w.workflowId) ?? { total: 0, completed: 0, failed: 0 } })) })
})
