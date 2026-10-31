import 'server-only'
import { z } from 'zod'
import { CATEGORIES } from '@/lib/domain/schemas'
import { decideTask, runInstance, type DecisionInput } from '@/lib/engine/engine'
import { getSettings } from '@/lib/engine/support'
import { getContext } from './context'
import { ok, parseBody, requireRole } from './http'

const BodySchema = z.object({
  comment: z.string().max(1000).default(''),
  overrideCategory: z.enum(CATEGORIES).optional(),
})

export async function handleDecision(req: Request, taskId: string, decision: DecisionInput['decision']) {
  const { actor, deps, store } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin', 'approver'])
  const body = await parseBody(req, BodySchema)
  if (decision !== 'APPROVED' && body.comment.trim().length < 3) {
    return Response.json(
      { ok: false, error: { code: 'COMMENT_REQUIRED', message: 'Un commento motivato è obbligatorio per rifiuto o richiesta modifiche' } },
      { status: 422 },
    )
  }
  const task = await decideTask(deps, taskId, { decision, comment: body.comment, overrideCategory: body.overrideCategory }, actor)
  const settings = await getSettings(store)
  if (settings.simulationSpeed === 'instant' && !settings.paused) await runInstance(deps, task.instanceId)
  return ok({ task })
}
