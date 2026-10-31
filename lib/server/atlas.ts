import 'server-only'
import { MongoClient, MongoServerError } from 'mongodb'
import { rerankWithVoyage, type Retriever } from '@/lib/classification/retriever'
import { voyageEmbed } from '@/lib/classification/voyage'
import type { KnowledgeExample, SemanticMatch } from '@/lib/domain/schemas'
import { ensureIndexes, type MongoStore } from '@/lib/store/mongo-store'
import { isInitialized, seedDatabase } from '@/lib/engine/seed'
import { redact } from './log'

export const VECTOR_INDEX = 'kb_vector_index'
export const AUTOEMBED_INDEX = 'kb_autoembed_index'
const KB = 'workflow_classification_knowledge'

export interface ConnectionTestResult {
  ok: boolean
  message: string
  checks: { label: string; ok: boolean; detail: string }[]
}

function explainMongoError(err: unknown): string {
  const msg = redact((err as Error).message ?? String(err))
  if (err instanceof MongoServerError && (err.code === 18 || /auth/i.test(msg))) return 'Autenticazione fallita: verificare utente e password del database user.'
  if (/ENOTFOUND|querySrv/i.test(msg)) return 'Host non risolvibile: verificare il nome del cluster nella connection string.'
  if (/Server selection timed out|timed out|ETIMEDOUT/i.test(msg))
    return 'Timeout di connessione: verificare che l’IP Access List di Atlas consenta le connessioni da Vercel (0.0.0.0/0 o IP statici) e che il cluster sia attivo.'
  return `Errore MongoDB: ${msg}`
}

/** Opens an isolated short-lived client, verifies reachability, privileges on the target DB and a write probe. */
export async function testMongoConnection(uri: string, databaseName: string): Promise<ConnectionTestResult> {
  const checks: ConnectionTestResult['checks'] = []
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000, maxPoolSize: 1, appName: 'gacc-connection-test' })
  try {
    await client.connect()
    const admin = client.db(databaseName)
    const ping = await admin.command({ ping: 1 })
    checks.push({ label: 'Connessione al cluster', ok: ping.ok === 1, detail: 'ping OK' })

    const status = await admin.command({ connectionStatus: 1, showPrivileges: true })
    const roles: { role: string; db: string }[] = status.authInfo?.authenticatedUserRoles ?? []
    const roleNames = roles.map((r) => `${r.role}@${r.db}`)
    const broad = roles.some((r) => ['root', 'atlasAdmin', 'dbAdminAnyDatabase', 'readWriteAnyDatabase'].includes(r.role))
    const scoped = roles.some((r) => r.db === databaseName && ['readWrite', 'dbOwner', 'dbAdmin'].includes(r.role))
    checks.push({
      label: 'Privilegi utente',
      ok: scoped || broad,
      detail: roleNames.length ? roleNames.join(', ') : 'Ruoli non disponibili (utente Atlas con ruoli custom)',
    })
    if (broad) checks.push({ label: 'Least privilege', ok: false, detail: 'Utente con privilegi estesi: consigliato un utente readWrite limitato al solo database demo' })
    else checks.push({ label: 'Least privilege', ok: true, detail: `Privilegi limitati al database ${databaseName}` })

    const probe = admin.collection('_gacc_probe')
    await probe.insertOne({ probe: true, at: new Date() })
    await probe.drop()
    checks.push({ label: 'Scrittura di prova', ok: true, detail: `insert/drop su ${databaseName}._gacc_probe` })

    let searchOk = true
    try {
      await admin.collection(KB).listSearchIndexes().toArray()
    } catch (e) {
      searchOk = !/not supported|CommandNotFound|unrecognized/i.test((e as Error).message) ? true : false
    }
    checks.push({ label: 'Atlas Search / Vector Search', ok: searchOk, detail: searchOk ? 'Comandi search index disponibili' : 'Search index non supportati su questo deployment' })

    const ok = checks.filter((c) => c.label !== 'Least privilege').every((c) => c.ok)
    return { ok, message: ok ? `Connessione verificata (MongoDB ${String((await admin.command({ buildInfo: 1 })).version)})` : 'Connessione riuscita con avvisi', checks }
  } catch (err) {
    checks.push({ label: 'Connessione al cluster', ok: false, detail: explainMongoError(err) })
    return { ok: false, message: explainMongoError(err), checks }
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function testVoyage(apiKey: string, model: string): Promise<{ ok: boolean; message: string; dimensions?: number }> {
  try {
    const r = await voyageEmbed(apiKey, model, ['Test di connessione Generali Automation Control Center'], 'query')
    return { ok: true, message: `Voyage AI raggiungibile · modello ${r.model} · ${r.embeddings[0].length} dimensioni`, dimensions: r.embeddings[0].length }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export interface InitializeOptions {
  voyageMode: 'simulated' | 'voyage-api' | 'atlas-auto'
  voyageApiKey: string | null
  model: string
  reseed: boolean
}

export interface InitializeReport {
  steps: { label: string; ok: boolean; detail: string }[]
  vectorIndex: 'NONE' | 'PENDING' | 'READY' | 'UNSUPPORTED' | 'FAILED'
  vectorIndexMessage: string | null
  kbEmbeddedModel: string | null
}

export async function initializeMongo(store: MongoStore, opts: InitializeOptions): Promise<InitializeReport> {
  const steps: InitializeReport['steps'] = []
  const created = await ensureIndexes(store)
  steps.push({ label: 'Collection e indici', ok: true, detail: created.join(', ') })

  if (opts.reseed || !(await isInitialized(store))) {
    const { inserted } = await seedDatabase(store)
    steps.push({ label: 'Dati sintetici', ok: true, detail: Object.entries(inserted).map(([k, v]) => `${k}: ${v}`).join(' · ') })
  } else {
    steps.push({ label: 'Dati sintetici', ok: true, detail: 'Database già inizializzato: dati esistenti preservati' })
  }

  let vectorIndex: InitializeReport['vectorIndex'] = 'NONE'
  let vectorIndexMessage: string | null = null
  let kbEmbeddedModel: string | null = null
  const kb = store.db.collection<KnowledgeExample>(KB)

  if (opts.voyageMode === 'voyage-api' && opts.voyageApiKey) {
    const docs = await kb.find({}, { projection: { _id: 0, exampleId: 1, exampleRequest: 1 } }).toArray()
    let dims = 0
    for (let i = 0; i < docs.length; i += 64) {
      const batch = docs.slice(i, i + 64)
      const r = await voyageEmbed(opts.voyageApiKey, opts.model, batch.map((d) => d.exampleRequest), 'document')
      dims = r.embeddings[0]?.length ?? dims
      await kb.bulkWrite(
        batch.map((d, j) => ({ updateOne: { filter: { exampleId: d.exampleId }, update: { $set: { embedding: r.embeddings[j], embeddingModel: opts.model } } } })),
      )
    }
    kbEmbeddedModel = opts.model
    steps.push({ label: 'Embedding Voyage AI', ok: true, detail: `${docs.length} esempi indicizzati con ${opts.model} (${dims} dimensioni)` })
    const r = await ensureSearchIndex(store, VECTOR_INDEX, {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: dims, similarity: 'cosine' },
        { type: 'filter', path: 'active' },
        { type: 'filter', path: 'embeddingModel' },
      ],
    })
    vectorIndex = r.status
    vectorIndexMessage = r.message
    steps.push({ label: 'Atlas Vector Search index', ok: r.status === 'READY' || r.status === 'PENDING', detail: r.message })
  } else if (opts.voyageMode === 'atlas-auto') {
    const r = await ensureSearchIndex(store, AUTOEMBED_INDEX, {
      fields: [
        { type: 'autoEmbed', modality: 'text', path: 'exampleRequest', model: opts.model },
        { type: 'filter', path: 'active' },
      ],
    })
    vectorIndex = r.status
    vectorIndexMessage = r.message
    kbEmbeddedModel = r.status === 'READY' || r.status === 'PENDING' ? `${opts.model} (Atlas auto-embedding)` : null
    steps.push({ label: 'Atlas Automated Embedding index', ok: r.status === 'READY' || r.status === 'PENDING', detail: r.message })
  } else {
    steps.push({ label: 'Classificazione semantica', ok: true, detail: 'Modalità simulata: nessun indice vettoriale creato, nessuna chiamata a Voyage AI' })
  }
  return { steps, vectorIndex, vectorIndexMessage, kbEmbeddedModel }
}

async function ensureSearchIndex(
  store: MongoStore,
  name: string,
  definition: Record<string, unknown>,
): Promise<{ status: InitializeReport['vectorIndex']; message: string }> {
  const kb = store.db.collection(KB)
  try {
    const existing = await kb.listSearchIndexes(name).toArray()
    if (existing.length) {
      await kb.updateSearchIndex(name, definition)
    } else {
      await kb.createSearchIndex({ name, type: 'vectorSearch', definition })
    }
  } catch (err) {
    const msg = redact((err as Error).message)
    const unsupported = /not supported|unrecognized|CommandNotFound|Unrecognized field|autoEmbed|preview|not enabled/i.test(msg)
    return { status: unsupported ? 'UNSUPPORTED' : 'FAILED', message: `Creazione indice ${name} non riuscita: ${msg}` }
  }
  return checkSearchIndex(store, name, 8)
}

export async function checkSearchIndex(store: MongoStore, name: string, polls = 1): Promise<{ status: InitializeReport['vectorIndex']; message: string }> {
  const kb = store.db.collection(KB)
  for (let i = 0; i < polls; i++) {
    try {
      const [idx] = (await kb.listSearchIndexes(name).toArray()) as { status?: string; queryable?: boolean }[]
      if (idx?.queryable) return { status: 'READY', message: `Indice ${name} pronto (queryable)` }
      if (idx?.status === 'FAILED') return { status: 'FAILED', message: `Indice ${name} in stato FAILED su Atlas` }
    } catch (err) {
      return { status: 'FAILED', message: redact((err as Error).message) }
    }
    if (i < polls - 1) await new Promise((r) => setTimeout(r, 2500))
  }
  return { status: 'PENDING', message: `Indice ${name} in costruzione su Atlas: la ricerca vettoriale sarà attiva appena l’indice diventa queryable` }
}

function toMatch(d: KnowledgeExample & { score: number }, cosineScore: number): SemanticMatch {
  return {
    exampleId: d.exampleId,
    category: d.category,
    subcategory: d.subcategory,
    workflowId: d.workflowId,
    exampleRequest: d.exampleRequest,
    score: Math.round(cosineScore * 10000) / 10000,
  }
}

/** Voyage AI query embedding + MongoDB Atlas $vectorSearch. Atlas cosine scores are normalized ((1+cos)/2); we report raw cosine. */
export class AtlasVectorRetriever implements Retriever {
  readonly method = 'VOYAGE_API_ATLAS_VECTOR_SEARCH' as const
  readonly simulated = false
  readonly description: string
  constructor(
    private readonly store: MongoStore,
    private readonly apiKey: string,
    readonly modelName: string,
    readonly rerankModel: string | null,
  ) {
    this.description = `Voyage AI (${modelName}) + MongoDB Atlas Vector Search ($vectorSearch su ${VECTOR_INDEX})`
  }
  async search(text: string, topK: number): Promise<SemanticMatch[]> {
    const { embeddings } = await voyageEmbed(this.apiKey, this.modelName, [text], 'query')
    const docs = await this.store.db
      .collection(KB)
      .aggregate<KnowledgeExample & { score: number }>([
        { $vectorSearch: { index: VECTOR_INDEX, path: 'embedding', queryVector: embeddings[0], numCandidates: Math.max(100, topK * 20), limit: topK, filter: { active: true, embeddingModel: this.modelName } } },
        { $project: { _id: 0, embedding: 0, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray()
    return docs.map((d) => toMatch(d, 2 * d.score - 1))
  }
  async rerank(text: string, matches: SemanticMatch[]) {
    return rerankWithVoyage(this.apiKey, this.rerankModel, text, matches)
  }
}

/** Atlas-managed embeddings (autoEmbed index, Preview): Atlas calls Voyage AI at index and query time. */
export class AtlasAutoEmbedRetriever implements Retriever {
  readonly method = 'ATLAS_AUTO_EMBEDDING' as const
  readonly simulated = false
  readonly rerankModel = null
  readonly description: string
  constructor(private readonly store: MongoStore, readonly modelName: string) {
    this.description = `MongoDB Atlas Automated Embedding (${modelName}) su indice ${AUTOEMBED_INDEX}`
  }
  async search(text: string, topK: number): Promise<SemanticMatch[]> {
    const docs = await this.store.db
      .collection(KB)
      .aggregate<KnowledgeExample & { score: number }>([
        { $vectorSearch: { index: AUTOEMBED_INDEX, path: 'exampleRequest', query: { text }, numCandidates: Math.max(100, topK * 20), limit: topK, filter: { active: true } } },
        { $project: { _id: 0, embedding: 0, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray()
    return docs.map((d) => toMatch(d, 2 * d.score - 1))
  }
}
