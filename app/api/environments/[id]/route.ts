import { z } from 'zod'
import { currentActor } from '@/lib/server/auth'
import { controlPlane, deleteEnvironment, getEnvironment, saveEnvironment, toPublic } from '@/lib/server/control-plane'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'
import { log } from '@/lib/server/log'
import { secretManager } from '@/lib/server/secrets'
import { MongoConfigSchema, VoyageConfigSchema, validateMongoUri } from '@/lib/server/validation'

type P = { id: string }

const PatchSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  mongo: MongoConfigSchema.optional(),
  voyage: VoyageConfigSchema.partial().extend({ mode: VoyageConfigSchema.shape.mode }).optional(),
  revokeVoyageKey: z.boolean().optional(),
})

async function owned(id: string) {
  const actor = await currentActor()
  requireRole(actor, ['admin'])
  const env = await getEnvironment(id, actor.id)
  if (!env) throw new HttpError(404, 'ENV_NOT_FOUND', 'Ambiente non trovato')
  if (!env.builtIn && env.ownerId !== actor.id) throw new HttpError(403, 'ENV_FORBIDDEN', 'Ambiente di proprietà di un altro utente')
  return { actor, env }
}

export const PATCH = route<P>('/api/environments/[id]', async (req, { params }) => {
  const { id } = await params
  const { actor, env } = await owned(id)
  const body = await parseBody(req, PatchSchema)
  const next = structuredClone(env)
  if (body.name && !env.builtIn) next.name = body.name

  if (body.mongo) {
    if (env.builtIn) throw new HttpError(400, 'BUILT_IN', 'Le credenziali degli ambienti predefiniti sono gestite tramite variabili d’ambiente Vercel')
    const v = validateMongoUri(body.mongo.connectionString, controlPlane().databaseName, body.mongo.databaseName)
    if (!v.ok) throw new HttpError(422, 'INVALID_DESTINATION', v.error ?? 'Destinazione non valida')
    const old = env.mongo?.connectionSecretRef
    const ref = await secretManager().put(actor.id, body.mongo.connectionString, `${env.environmentId}:mongodb`)
    if (old) await secretManager().revoke(old)
    next.mongo = { connectionSecretRef: ref, databaseName: body.mongo.databaseName, host: v.host ?? null, connectionMode: v.mode ?? 'srv' }
    next.status = { ...next.status, mongo: 'UNTESTED', mongoMessage: 'Credenziali sostituite: eseguire un nuovo test', initializedAt: env.mongo?.databaseName === body.mongo.databaseName ? env.status.initializedAt : null }
  }

  if (body.voyage) {
    const v = body.voyage
    if (v.apiKey) {
      const old = env.voyage.apiKeySecretRef
      next.voyage.apiKeySecretRef = await secretManager().put(actor.id, v.apiKey, `${env.environmentId}:voyage`)
      if (old && old.startsWith('sm://')) await secretManager().revoke(old)
      next.status.voyage = 'UNTESTED'
    }
    if (v.mode === 'voyage-api' && !next.voyage.apiKeySecretRef) throw new HttpError(422, 'VOYAGE_KEY_REQUIRED', 'Specificare una API key Voyage AI')
    if (v.mode === 'atlas-auto' && !env.mongo) throw new HttpError(422, 'ATLAS_REQUIRED', 'Atlas Automated Embedding richiede un ambiente MongoDB Atlas')
    const modeChanged = v.mode !== env.voyage.mode || (v.model && v.model !== env.voyage.model)
    next.voyage.mode = v.mode
    if (v.model) next.voyage.model = v.model
    if (v.rerankModel !== undefined) next.voyage.rerankModel = v.rerankModel
    if (modeChanged) {
      next.status.vectorIndex = 'NONE'
      next.status.vectorIndexMessage = env.mongo ? 'Modalità modificata: rieseguire l’inizializzazione per creare l’indice vettoriale' : null
      next.status.voyage = v.mode === 'simulated' ? 'NOT_CONFIGURED' : 'UNTESTED'
    }
  }

  if (body.revokeVoyageKey && env.voyage.apiKeySecretRef?.startsWith('sm://')) {
    await secretManager().revoke(env.voyage.apiKeySecretRef)
    next.voyage.apiKeySecretRef = null
    next.voyage.mode = 'simulated'
    next.status.voyage = 'NOT_CONFIGURED'
  }

  await saveEnvironment(next)
  log('INFO', 'Environment updated', { environmentId: id, actor: actor.id })
  return ok({ environment: toPublic(next) })
})

export const DELETE = route<P>('/api/environments/[id]', async (_req, { params }) => {
  const { id } = await params
  const { env } = await owned(id)
  if (env.builtIn) throw new HttpError(400, 'BUILT_IN', 'Gli ambienti predefiniti non possono essere eliminati')
  if (env.mongo?.connectionSecretRef) await secretManager().revoke(env.mongo.connectionSecretRef)
  if (env.voyage.apiKeySecretRef) await secretManager().revoke(env.voyage.apiKeySecretRef)
  await deleteEnvironment(id)
  log('INFO', 'Environment deleted and secrets revoked', { environmentId: id })
  return ok({ deleted: id })
})
