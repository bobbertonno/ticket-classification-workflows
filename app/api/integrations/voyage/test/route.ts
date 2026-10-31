import { z } from 'zod'
import { testVoyage } from '@/lib/server/atlas'
import { currentActor } from '@/lib/server/auth'
import { DEFAULT_VOYAGE_MODEL, getEnvironment, saveEnvironment } from '@/lib/server/control-plane'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'
import { secretManager } from '@/lib/server/secrets'

export const maxDuration = 30

const Schema = z.union([
  z.object({ environmentId: z.string().min(1) }),
  z.object({ apiKey: z.string().min(10).max(256), model: z.string().min(3).max(60).default(DEFAULT_VOYAGE_MODEL) }),
])

export const POST = route('/api/integrations/voyage/test', async (req) => {
  const actor = await currentActor()
  requireRole(actor, ['admin'])
  const body = await parseBody(req, Schema)

  if ('environmentId' in body) {
    const env = await getEnvironment(body.environmentId, actor.id)
    if (!env) throw new HttpError(404, 'ENV_NOT_FOUND', 'Ambiente non trovato')
    if (!env.builtIn && env.ownerId !== actor.id) throw new HttpError(403, 'ENV_FORBIDDEN', 'Ambiente non accessibile')
    if (env.voyage.mode === 'simulated') return ok({ ok: true, message: 'Classificazione semantica simulata: nessuna chiamata a Voyage AI', simulated: true })
    if (env.voyage.mode === 'atlas-auto') {
      const msg =
        'Atlas Automated Embedding: la chiave Voyage AI è gestita dal progetto Atlas. La disponibilità viene verificata creando l’indice autoEmbed durante l’inizializzazione.'
      return ok({ ok: env.status.vectorIndex === 'READY', message: env.status.vectorIndexMessage ?? msg })
    }
    const key = env.voyage.apiKeySecretRef ? await secretManager().resolve(env.voyage.apiKeySecretRef) : null
    if (!key) throw new HttpError(409, 'CREDENTIALS_UNAVAILABLE', 'API key Voyage AI non disponibile o revocata')
    const result = await testVoyage(key, env.voyage.model)
    await saveEnvironment({ ...env, status: { ...env.status, voyage: result.ok ? 'CONNECTED' : 'ERROR', voyageMessage: result.message } })
    return ok(result)
  }
  return ok(await testVoyage(body.apiKey, body.model))
})
