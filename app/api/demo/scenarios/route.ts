import { z } from 'zod'
import { SCENARIOS } from '@/lib/domain/seed-data'
import { publishTicketEvent, runInstance } from '@/lib/engine/engine'
import { getSettings } from '@/lib/engine/support'
import { getContext } from '@/lib/server/context'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'

export const maxDuration = 60

export const GET = route('/api/demo/scenarios', async () => ok({ scenarios: SCENARIOS }))

export const POST = route('/api/demo/scenarios', async (req) => {
  const { actor, deps, store } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin'])
  const { scenarioId } = await parseBody(req, z.object({ scenarioId: z.enum(['A', 'B', 'C', 'D']) }))
  const scenario = SCENARIOS.find((s) => s.scenarioId === scenarioId)
  if (!scenario) throw new HttpError(404, 'NOT_FOUND', 'Scenario non trovato')
  const agency = await store.collection('agencies').findOne({ agencyId: scenario.agencyId })
  const result = await publishTicketEvent(
    deps,
    {
      scenarioId,
      topic: 'remedy.ticket.created',
      agencyId: scenario.agencyId,
      operatorName: agency?.operatorName ?? 'Operatore demo',
      priority: scenario.priority,
      subject: scenario.subject,
      description: scenario.description,
      metadata: scenario.metadata,
    },
    actor,
  )
  const settings = await getSettings(store)
  if (result.instanceId && settings.simulationSpeed === 'instant' && !settings.paused) await runInstance(deps, result.instanceId)
  return ok(result, 201)
})
