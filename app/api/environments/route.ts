import { z } from 'zod'
import { randomId } from '@/lib/domain/ids'
import { currentActor, selectedEnvironmentId } from '@/lib/server/auth'
import { DEFAULT_VOYAGE_MODEL, controlPlane, listEnvironments, newEnvironmentStatus, saveEnvironment, toPublic, type EnvironmentRecord } from '@/lib/server/control-plane'
import { platformInfo } from '@/lib/server/context'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'
import { log } from '@/lib/server/log'
import { secretManager } from '@/lib/server/secrets'
import { MongoConfigSchema, VoyageConfigSchema, validateMongoUri } from '@/lib/server/validation'

export const GET = route('/api/environments', async () => {
  const actor = await currentActor()
  const environments = (await listEnvironments(actor.id)).map(toPublic)
  return ok({ environments, selectedId: await selectedEnvironmentId(), platform: platformInfo() })
})

const CreateSchema = z.object({
  name: z.string().min(2).max(60),
  type: z.enum(['CUSTOM_ATLAS', 'DEVELOPMENT']).default('CUSTOM_ATLAS'),
  mongo: MongoConfigSchema,
  voyage: VoyageConfigSchema,
})

export const POST = route('/api/environments', async (req) => {
  const actor = await currentActor()
  requireRole(actor, ['admin'])
  const body = await parseBody(req, CreateSchema)
  const v = validateMongoUri(body.mongo.connectionString, controlPlane().databaseName, body.mongo.databaseName)
  if (!v.ok) throw new HttpError(422, 'INVALID_DESTINATION', v.error ?? 'Destinazione non valida')
  if (body.voyage.mode === 'voyage-api' && !body.voyage.apiKey) throw new HttpError(422, 'VOYAGE_KEY_REQUIRED', 'La modalità API esterna richiede una API key Voyage AI')

  const environmentId = randomId('ENV').toLowerCase()
  const connectionSecretRef = await secretManager().put(actor.id, body.mongo.connectionString, `${environmentId}:mongodb`)
  const apiKeySecretRef = body.voyage.mode === 'voyage-api' && body.voyage.apiKey ? await secretManager().put(actor.id, body.voyage.apiKey, `${environmentId}:voyage`) : null
  const now = new Date().toISOString()
  const env: EnvironmentRecord = {
    environmentId,
    name: body.name,
    type: body.type,
    ownerId: actor.id,
    builtIn: false,
    mongo: { connectionSecretRef, databaseName: body.mongo.databaseName, host: v.host ?? null, connectionMode: v.mode ?? 'srv' },
    voyage: { mode: body.voyage.mode, apiKeySecretRef, model: body.voyage.model ?? DEFAULT_VOYAGE_MODEL, rerankModel: body.voyage.rerankModel },
    status: { ...newEnvironmentStatus(), mongo: 'UNTESTED', voyage: body.voyage.mode === 'simulated' ? 'NOT_CONFIGURED' : 'UNTESTED' },
    createdAt: now,
    updatedAt: now,
  }
  await saveEnvironment(env)
  log('INFO', 'Environment created', { environmentId, host: v.host, databaseName: body.mongo.databaseName, owner: actor.id })
  return ok({ environment: toPublic(env) }, 201)
})
