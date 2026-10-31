import { AppSettingsSchema } from '@/lib/domain/schemas'
import { audit, getSettings } from '@/lib/engine/support'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, requireRole, route } from '@/lib/server/http'

export const GET = route('/api/settings', async () => {
  const { store } = await getContext()
  return ok({ settings: await getSettings(store) })
})

export const PATCH = route('/api/settings', async (req) => {
  const { store, actor } = await getContext({ requireInitialized: true })
  requireRole(actor, ['admin'])
  const patch = await parseBody(req, AppSettingsSchema.partial())
  const prev = await getSettings(store)
  const next = { ...prev, ...patch, key: 'app' as const }
  const settingsCol = store.collection('app_settings')
  if (!(await settingsCol.updateOne({ key: 'app' }, next))) await settingsCol.insertOne(next)
  const changed = Object.keys(patch).filter((k) => JSON.stringify(prev[k as keyof typeof prev]) !== JSON.stringify(next[k as keyof typeof next]))
  if (changed.length) {
    await audit(store, {
      actor: actor.name,
      actorType: 'USER',
      agencyId: null,
      instanceId: null,
      ticketId: null,
      action: 'SETTINGS_UPDATED',
      previousState: JSON.stringify(Object.fromEntries(changed.map((k) => [k, prev[k as keyof typeof prev]]))),
      newState: JSON.stringify(Object.fromEntries(changed.map((k) => [k, next[k as keyof typeof next]]))),
      correlationId: null,
      outcome: 'SUCCESS',
      eventType: 'SETTINGS',
      details: JSON.stringify({ changed }),
    })
  }
  return ok({ settings: next })
})
