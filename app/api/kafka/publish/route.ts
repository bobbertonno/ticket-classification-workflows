import { PublishEventSchema } from '@/lib/domain/schemas'
import { publishTicketEvent, runInstance } from '@/lib/engine/engine'
import { getSettings } from '@/lib/engine/support'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, requireRole, route } from '@/lib/server/http'

export const maxDuration = 60

export const POST = route('/api/kafka/publish', async (req) => {
  const { actor, deps, store } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin', 'approver'])
  const input = await parseBody(req, PublishEventSchema)
  const result = await publishTicketEvent(deps, input, actor)
  const settings = await getSettings(store)
  if (result.instanceId && !result.duplicate && settings.simulationSpeed === 'instant' && !settings.paused) {
    await runInstance(deps, result.instanceId)
  }
  return ok(result, result.duplicate ? 200 : 201)
})
