import { z } from 'zod'
import { initializeMongo } from '@/lib/server/atlas'
import { currentActor } from '@/lib/server/auth'
import { getEnvironment, saveEnvironment, toPublic } from '@/lib/server/control-plane'
import { resolveStore } from '@/lib/server/context'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'
import { log } from '@/lib/server/log'
import { secretManager } from '@/lib/server/secrets'
import { resetDemo, seedDatabase } from '@/lib/engine/seed'
import type { MongoStore } from '@/lib/store/mongo-store'

export const maxDuration = 60

export const POST = route('/api/setup/initialize', async (req) => {
  const actor = await currentActor()
  requireRole(actor, ['admin'])
  const { environmentId, reseed } = await parseBody(req, z.object({ environmentId: z.string().min(1), reseed: z.boolean().default(false) }))
  const env = await getEnvironment(environmentId, actor.id)
  if (!env) throw new HttpError(404, 'ENV_NOT_FOUND', 'Ambiente non trovato')
  if (!env.builtIn && env.ownerId !== actor.id) throw new HttpError(403, 'ENV_FORBIDDEN', 'Ambiente non accessibile')

  const store = await resolveStore(env)
  if (store.kind === 'memory') {
    if (reseed) await resetDemo(store, actor.name)
    else await seedDatabase(store)
    const next = { ...env, status: { ...env.status, initializedAt: new Date().toISOString() } }
    await saveEnvironment(next)
    return ok({ environment: toPublic(next), report: { steps: [{ label: 'Dataset sintetico in-memory', ok: true, detail: 'Dati demo caricati nel simulatore (non persistiti in MongoDB)' }], vectorIndex: 'NONE', vectorIndexMessage: null } })
  }

  const voyageKey = env.voyage.mode === 'voyage-api' && env.voyage.apiKeySecretRef ? await secretManager().resolve(env.voyage.apiKeySecretRef) : null
  if (env.voyage.mode === 'voyage-api' && !voyageKey) throw new HttpError(409, 'CREDENTIALS_UNAVAILABLE', 'API key Voyage AI non disponibile')

  try {
    const report = await initializeMongo(store as MongoStore, { voyageMode: env.voyage.mode, voyageApiKey: voyageKey, model: env.voyage.model, reseed })
    const next = {
      ...env,
      status: {
        ...env.status,
        mongo: 'CONNECTED' as const,
        initializedAt: new Date().toISOString(),
        vectorIndex: report.vectorIndex,
        vectorIndexMessage: report.vectorIndexMessage,
        kbEmbeddedModel: report.kbEmbeddedModel,
        ...(env.voyage.mode === 'voyage-api' ? { voyage: 'CONNECTED' as const, voyageMessage: `Embedding generati con ${env.voyage.model}` } : {}),
      },
    }
    await saveEnvironment(next)
    log('INFO', 'Environment initialized', { environmentId, vectorIndex: report.vectorIndex })
    return ok({ environment: toPublic(next), report })
  } catch (err) {
    const message = (err as Error).message
    await saveEnvironment({ ...env, status: { ...env.status, mongoMessage: `Inizializzazione fallita: ${message}` } })
    throw new HttpError(502, 'INITIALIZATION_FAILED', `Inizializzazione non completata: ${message}`)
  }
})
