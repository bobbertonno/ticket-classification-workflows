import { buildDashboard } from '@/lib/engine/analytics'
import { INSTANCE_STATUSES } from '@/lib/domain/schemas'
import type { ExecutionMode, InstanceStatus } from '@/lib/domain/schemas'
import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'

export const GET = route('/api/dashboard', async (req) => {
  const { store, integration } = await getContext()
  const url = new URL(req.url)
  const p = (k: string) => {
    const v = url.searchParams.get(k)
    return v && v !== 'all' ? v : undefined
  }
  const status = p('status')
  const mode = p('mode')
  const data = await buildDashboard(store, {
    from: p('from'),
    to: p('to'),
    agencyId: p('agencyId'),
    workflowId: p('workflowId'),
    status: status && (INSTANCE_STATUSES as readonly string[]).includes(status) ? (status as InstanceStatus) : undefined,
    mode: mode && ['AUTOMATED', 'HITL', 'MANUAL_TRIAGE'].includes(mode) ? (mode as ExecutionMode) : undefined,
  })
  return ok({ ...data, integration })
})
