import { z } from 'zod'
import { testMongoConnection } from '@/lib/server/atlas'
import { currentActor } from '@/lib/server/auth'
import { controlPlane, getEnvironment, saveEnvironment } from '@/lib/server/control-plane'
import { HttpError, ok, parseBody, requireRole, route } from '@/lib/server/http'
import { secretManager } from '@/lib/server/secrets'
import { DatabaseNameSchema, validateMongoUri } from '@/lib/server/validation'

export const maxDuration = 30

const Schema = z.union([
  z.object({ environmentId: z.string().min(1) }),
  z.object({ connectionString: z.string().min(10).max(1024), databaseName: DatabaseNameSchema }),
])

export const POST = route('/api/integrations/mongodb/test', async (req) => {
  const actor = await currentActor()
  requireRole(actor, ['admin'])
  const body = await parseBody(req, Schema)

  if ('environmentId' in body) {
    const env = await getEnvironment(body.environmentId, actor.id)
    if (!env?.mongo) throw new HttpError(404, 'ENV_NOT_FOUND', 'Ambiente MongoDB non trovato')
    if (!env.builtIn && env.ownerId !== actor.id) throw new HttpError(403, 'ENV_FORBIDDEN', 'Ambiente non accessibile')
    const uri = env.mongo.connectionSecretRef ? await secretManager().resolve(env.mongo.connectionSecretRef) : null
    if (!uri) throw new HttpError(409, 'CREDENTIALS_UNAVAILABLE', 'Credenziali non disponibili o revocate')
    const v = validateMongoUri(uri, controlPlane().databaseName, env.mongo.databaseName)
    if (!v.ok) throw new HttpError(422, 'INVALID_DESTINATION', v.error ?? 'Destinazione non valida')
    const result = await testMongoConnection(uri, env.mongo.databaseName)
    await saveEnvironment({
      ...env,
      status: { ...env.status, mongo: result.ok ? 'CONNECTED' : 'ERROR', mongoMessage: result.message, mongoCheckedAt: new Date().toISOString() },
    })
    return ok(result)
  }

  const v = validateMongoUri(body.connectionString, controlPlane().databaseName, body.databaseName)
  if (!v.ok) throw new HttpError(422, 'INVALID_DESTINATION', v.error ?? 'Destinazione non valida')
  return ok(await testMongoConnection(body.connectionString, body.databaseName))
})
