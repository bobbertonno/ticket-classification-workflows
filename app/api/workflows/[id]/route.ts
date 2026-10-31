import { z } from 'zod'
import { audit } from '@/lib/engine/support'
import { getContext } from '@/lib/server/context'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'

const PatchSchema = z.object({
  slaMinutes: z.number().int().min(5).max(10080).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'DEPRECATED']).optional(),
  retryPolicy: z.object({ maxAttempts: z.number().int().min(1).max(10), backoffMs: z.number().int().min(0).max(600000) }).optional(),
  approvalPolicy: z
    .object({
      approverRole: z.enum(['approver', 'admin']),
      assignedTeam: z.string().min(2).max(60),
      dueInMinutes: z.number().int().min(5).max(10080),
      onReject: z.enum(['escalate', 'cancel']),
    })
    .partial()
    .optional(),
})

export const GET = route<{ id: string }>('/api/workflows/[id]', async (_req, { params }) => {
  const { id } = await params
  const { store } = await getContext()
  const workflow = await store.collection('workflow_definitions').findOne({ workflowId: id })
  if (!workflow) throw new HttpError(404, 'NOT_FOUND', `Workflow ${id} non trovato`)
  return ok({ workflow })
})

/** Configuration-only edits: structural step changes are not supported by the MVP engine. */
export const PATCH = route<{ id: string }>('/api/workflows/[id]', async (req, { params }) => {
  const { id } = await params
  const { store, actor } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin'])
  const patch = await parseBody(req, PatchSchema)
  const prev = await store.collection('workflow_definitions').findOne({ workflowId: id })
  if (!prev) throw new HttpError(404, 'NOT_FOUND', `Workflow ${id} non trovato`)
  const next = {
    ...prev,
    ...(patch.slaMinutes !== undefined ? { slaMinutes: patch.slaMinutes } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.retryPolicy ? { retryPolicy: patch.retryPolicy } : {}),
    approvalPolicy: { ...prev.approvalPolicy, ...(patch.approvalPolicy ?? {}) },
    updatedAt: new Date().toISOString(),
  }
  await store.collection('workflow_definitions').updateOne({ workflowId: id }, next)
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: null,
    instanceId: null,
    ticketId: null,
    action: 'WORKFLOW_CONFIG_UPDATED',
    previousState: JSON.stringify({ slaMinutes: prev.slaMinutes, status: prev.status, retryPolicy: prev.retryPolicy }),
    newState: JSON.stringify({ slaMinutes: next.slaMinutes, status: next.status, retryPolicy: next.retryPolicy }),
    correlationId: null,
    outcome: 'SUCCESS',
    eventType: 'WORKFLOW',
    details: JSON.stringify({ workflowId: id }),
  })
  return ok({ workflow: next })
})
