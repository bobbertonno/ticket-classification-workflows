import 'server-only'
import { SimulatedRetriever, VoyageInMemoryRetriever, type Retriever } from '@/lib/classification/retriever'
import type { EngineDeps } from '@/lib/engine/engine'
import { ensureSeeded } from '@/lib/engine/seed'
import type { Actor } from '@/lib/engine/support'
import { getMemoryStore } from '@/lib/store/memory-store'
import { createMongoStore, type MongoStore } from '@/lib/store/mongo-store'
import type { DataStore } from '@/lib/store/types'
import { AUTOEMBED_INDEX, AtlasAutoEmbedRetriever, AtlasVectorRetriever, VECTOR_INDEX, checkSearchIndex } from './atlas'
import { currentActor, selectedEnvironmentId } from './auth'
import { controlPlane, getEnvironment, saveEnvironment, type EnvironmentRecord } from './control-plane'
import { log } from './log'
import { secretManager } from './secrets'

export class ContextError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

export interface IntegrationInfo {
  environmentId: string
  environmentName: string
  environmentType: EnvironmentRecord['type']
  dataProvider: 'memory' | 'mongodb'
  dataLabel: string
  persistent: boolean
  classification: { method: string; simulated: boolean; modelName: string; description: string }
}

export interface RequestContext {
  actor: Actor & { email: string; description: string }
  env: EnvironmentRecord
  store: DataStore
  deps: EngineDeps
  integration: IntegrationInfo
}

const indexCheckedAt = new Map<string, number>()

async function refreshPendingIndex(env: EnvironmentRecord, store: MongoStore): Promise<EnvironmentRecord> {
  if (env.status.vectorIndex !== 'PENDING') return env
  const last = indexCheckedAt.get(env.environmentId) ?? 0
  if (Date.now() - last < 20_000) return env
  indexCheckedAt.set(env.environmentId, Date.now())
  const name = env.voyage.mode === 'atlas-auto' ? AUTOEMBED_INDEX : VECTOR_INDEX
  const r = await checkSearchIndex(store, name, 1)
  if (r.status === 'PENDING') return env
  const next = { ...env, status: { ...env.status, vectorIndex: r.status, vectorIndexMessage: r.message } }
  await saveEnvironment(next)
  return next
}

export async function buildRetriever(env: EnvironmentRecord, store: DataStore): Promise<Retriever> {
  const { voyage, status } = env
  if (voyage.mode === 'simulated') return new SimulatedRetriever(store)

  if (voyage.mode === 'atlas-auto') {
    if (store.kind !== 'mongodb') return unavailable(store, 'Atlas Automated Embedding richiede un ambiente MongoDB Atlas')
    if (status.vectorIndex !== 'READY') return unavailable(store, `Indice ${AUTOEMBED_INDEX} non pronto (${status.vectorIndex})`)
    return new AtlasAutoEmbedRetriever(store as MongoStore, voyage.model)
  }

  const apiKey = voyage.apiKeySecretRef ? await secretManager().resolve(voyage.apiKeySecretRef) : null
  if (!apiKey) return unavailable(store, 'API key Voyage AI non disponibile nel secret manager')
  if (store.kind === 'mongodb' && status.vectorIndex === 'READY') return new AtlasVectorRetriever(store as MongoStore, apiKey, voyage.model, voyage.rerankModel)
  return new VoyageInMemoryRetriever(store, apiKey, voyage.model, voyage.rerankModel)
}

/** A retriever whose search always fails, so the classifier records an explicit, labeled fallback instead of silently simulating. */
function unavailable(store: DataStore, reason: string): Retriever {
  const sim = new SimulatedRetriever(store)
  return {
    method: sim.method,
    simulated: true,
    modelName: sim.modelName,
    rerankModel: null,
    description: `Provider configurato non disponibile: ${reason}. Fallback deterministico etichettato.`,
    async search() {
      throw new Error(reason)
    },
  }
}

export async function resolveStore(env: EnvironmentRecord): Promise<DataStore> {
  if (!env.mongo) {
    const store = getMemoryStore(env.environmentId)
    await ensureSeeded(store)
    return store
  }
  const uri = env.mongo.connectionSecretRef ? await secretManager().resolve(env.mongo.connectionSecretRef) : null
  if (!uri) throw new ContextError('Credenziali MongoDB non disponibili o revocate: aggiornarle in Settings & Integrations', 409, 'CREDENTIALS_UNAVAILABLE')
  try {
    return await createMongoStore(uri, env.mongo.databaseName)
  } catch (err) {
    log('ERROR', 'MongoDB connection failed', { environmentId: env.environmentId, error: (err as Error).message })
    throw new ContextError('Cluster MongoDB non raggiungibile. Verificare stato del cluster e IP Access List di Atlas.', 503, 'MONGO_UNAVAILABLE')
  }
}

export async function getContext(opts: { requireInitialized?: boolean } = {}): Promise<RequestContext> {
  const actor = await currentActor()
  const envId = await selectedEnvironmentId()
  let env = (await getEnvironment(envId, actor.id)) ?? (await getEnvironment('demo', actor.id))
  if (!env) throw new ContextError('Ambiente non trovato', 404, 'ENV_NOT_FOUND')
  if (!env.builtIn && env.ownerId !== actor.id) throw new ContextError('Accesso all’ambiente negato', 403, 'ENV_FORBIDDEN')
  if ((opts.requireInitialized ?? true) && env.mongo && !env.status.initializedAt)
    throw new ContextError(`L’ambiente "${env.name}" non è ancora inizializzato: completare il Setup Wizard`, 409, 'NOT_INITIALIZED')

  const store = await resolveStore(env)
  if (store.kind === 'mongodb') env = await refreshPendingIndex(env, store as MongoStore)
  const retriever = await buildRetriever(env, store)
  return {
    actor,
    env,
    store,
    deps: { store, retriever },
    integration: {
      environmentId: env.environmentId,
      environmentName: env.name,
      environmentType: env.type,
      dataProvider: store.kind,
      dataLabel: store.label,
      persistent: store.kind === 'mongodb',
      classification: { method: retriever.method, simulated: retriever.simulated, modelName: retriever.modelName, description: retriever.description },
    },
  }
}

export function platformInfo() {
  return { controlPlane: controlPlane().description, controlPlanePersistent: controlPlane().persistent, secretManager: secretManager().description, secretsPersistent: secretManager().persistent }
}
