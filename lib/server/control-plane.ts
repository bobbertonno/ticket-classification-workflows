import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { Document } from 'mongodb'
import { cookies } from 'next/headers'
import { getMongoClient } from '@/lib/store/mongo-store'
import { COOKIE_OPTIONS } from './auth'
import { deriveKey, masterSecret } from './keys'
import type { StoredSecret } from './secrets'

export type EnvironmentType = 'DEMO' | 'DEVELOPMENT' | 'CUSTOM_ATLAS'
export type VoyageMode = 'simulated' | 'voyage-api' | 'atlas-auto'
export type IntegrationStatus = 'NOT_CONFIGURED' | 'UNTESTED' | 'CONNECTED' | 'ERROR'
export type VectorIndexStatus = 'NONE' | 'PENDING' | 'READY' | 'UNSUPPORTED' | 'FAILED'

export interface EnvironmentRecord {
  environmentId: string
  name: string
  type: EnvironmentType
  ownerId: string
  builtIn: boolean
  mongo: {
    connectionSecretRef: string | null
    databaseName: string
    host: string | null
    connectionMode: 'srv' | 'standard'
  } | null
  voyage: {
    mode: VoyageMode
    apiKeySecretRef: string | null
    model: string
    rerankModel: string | null
  }
  status: {
    mongo: IntegrationStatus
    mongoMessage: string | null
    mongoCheckedAt: string | null
    voyage: IntegrationStatus
    voyageMessage: string | null
    initializedAt: string | null
    vectorIndex: VectorIndexStatus
    vectorIndexMessage: string | null
    kbEmbeddedModel: string | null
  }
  createdAt: string
  updatedAt: string
}

/** Browser-safe projection: secret references are never serialized, only their presence. */
export interface PublicEnvironment extends Omit<EnvironmentRecord, 'mongo' | 'voyage'> {
  mongo: { databaseName: string; host: string | null; connectionMode: 'srv' | 'standard'; hasCredentials: boolean; credentialSource: 'env' | 'secret-manager' | null } | null
  voyage: { mode: VoyageMode; model: string; rerankModel: string | null; hasApiKey: boolean; keySource: 'env' | 'secret-manager' | null }
}

export function toPublic(e: EnvironmentRecord): PublicEnvironment {
  const src = (ref: string | null) => (ref ? (ref.startsWith('env://') ? 'env' : 'secret-manager') : null)
  return {
    ...e,
    mongo: e.mongo
      ? {
          databaseName: e.mongo.databaseName,
          host: e.mongo.host,
          connectionMode: e.mongo.connectionMode,
          hasCredentials: !!e.mongo.connectionSecretRef,
          credentialSource: src(e.mongo.connectionSecretRef),
        }
      : null,
    voyage: {
      mode: e.voyage.mode,
      model: e.voyage.model,
      rerankModel: e.voyage.rerankModel,
      hasApiKey: !!e.voyage.apiKeySecretRef,
      keySource: src(e.voyage.apiKeySecretRef),
    },
  }
}

interface KV<T extends Document> {
  find(filter: Partial<T>): Promise<T[]>
  findOne(filter: Partial<T>): Promise<T | null>
  insertOne(doc: T): Promise<void>
  updateOne(filter: Partial<T>, set: Partial<T>): Promise<boolean>
  deleteOne(filter: Partial<T>): Promise<void>
}

function memoryKV<T extends Document>(rows: T[]): KV<T> {
  const match = (r: T, f: Partial<T>) => Object.entries(f).every(([k, v]) => r[k] === v)
  return {
    async find(f) {
      return rows.filter((r) => match(r, f)).map((r) => structuredClone(r))
    },
    async findOne(f) {
      const r = rows.find((x) => match(x, f))
      return r ? structuredClone(r) : null
    },
    async insertOne(d) {
      rows.push(structuredClone(d))
    },
    async updateOne(f, s) {
      const r = rows.find((x) => match(x, f))
      if (!r) return false
      Object.assign(r, structuredClone(s))
      return true
    },
    async deleteOne(f) {
      const i = rows.findIndex((x) => match(x, f))
      if (i >= 0) rows.splice(i, 1)
    },
  }
}

function mongoKV<T extends Document>(uri: string, db: string, name: string): KV<T> {
  const col = async () => (await getMongoClient(uri)).db(db).collection<T>(name)
  const proj = { projection: { _id: 0 } }
  return {
    async find(f) {
      return (await (await col()).find(f as never, proj).toArray()) as unknown as T[]
    },
    async findOne(f) {
      return (await (await col()).findOne(f as never, proj)) as unknown as T | null
    },
    async insertOne(d) {
      await (await col()).insertOne({ ...d } as never)
    },
    async updateOne(f, s) {
      return (await (await col()).updateOne(f as never, { $set: s } as never)).matchedCount > 0
    },
    async deleteOne(f) {
      await (await col()).deleteOne(f as never)
    },
  }
}

interface ControlState {
  environments: EnvironmentRecord[]
  secrets: StoredSecret[]
}

const g = globalThis as unknown as { __gaccControl?: ControlState }

const CONTROL_COOKIE = 'gacc_cp'
const MAX_COOKIE_CHARS = 3800
const requestStates = new WeakMap<object, ControlState>()

function sealState(state: ControlState): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey('control-plane-cookie'), iv)
  const ct = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(state)))), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

function unsealState(value: string | undefined): ControlState {
  if (!value) return { environments: [], secrets: [] }
  try {
    const buf = Buffer.from(value, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', deriveKey('control-plane-cookie'), buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const plain = inflateRawSync(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]))
    const parsed = JSON.parse(plain.toString('utf8')) as ControlState
    return { environments: parsed.environments ?? [], secrets: parsed.secrets ?? [] }
  } catch {
    return { environments: [], secrets: [] }
  }
}

/**
 * Stateless control plane for deployments without CONTROL_PLANE_MONGODB_URI: environment records and
 * their (already AES-GCM encrypted) secrets are sealed into an HttpOnly, encrypted cookie so they survive
 * across serverless instances. Outside a request (tests, scripts) it falls back to process memory.
 */
async function sealedKV<K extends keyof ControlState>(name: K): Promise<KV<ControlState[K][number]>> {
  let jar: Awaited<ReturnType<typeof cookies>> | null = null
  try {
    jar = await cookies()
  } catch {
    g.__gaccControl ??= { environments: [], secrets: [] }
    return memoryKV(g.__gaccControl[name] as ControlState[K][number][])
  }
  const cookieJar = jar
  let state = requestStates.get(cookieJar)
  if (!state) {
    state = unsealState(cookieJar.get(CONTROL_COOKIE)?.value)
    requestStates.set(cookieJar, state)
  }
  const current = state
  const inner = memoryKV(current[name] as ControlState[K][number][])
  const commit = () => {
    const sealed = sealState(current)
    if (sealed.length > MAX_COOKIE_CHARS) {
      throw new Error('Spazio del control plane esaurito: eliminare un ambiente o configurare CONTROL_PLANE_MONGODB_URI')
    }
    try {
      cookieJar.set(CONTROL_COOKIE, sealed, COOKIE_OPTIONS)
    } catch {
      // Read-only context (Server Component render): mutations are only issued from Route Handlers.
    }
  }
  return {
    find: inner.find,
    findOne: inner.findOne,
    async insertOne(d) {
      await inner.insertOne(d)
      commit()
    },
    async updateOne(f, s) {
      const changed = await inner.updateOne(f, s)
      if (changed) commit()
      return changed
    },
    async deleteOne(f) {
      await inner.deleteOne(f)
      commit()
    },
  }
}

class ControlPlane {
  readonly databaseName: string
  private readonly uri: string | undefined
  constructor() {
    this.uri = process.env.CONTROL_PLANE_MONGODB_URI
    this.databaseName = process.env.CONTROL_PLANE_DB ?? 'gacc_control'
  }
  get persistent(): boolean {
    return !!this.uri || masterSecret().stable
  }
  async environments(): Promise<KV<EnvironmentRecord>> {
    return this.uri ? mongoKV(this.uri, this.databaseName, 'environments') : sealedKV('environments')
  }
  async secrets(): Promise<KV<StoredSecret>> {
    return this.uri ? mongoKV(this.uri, this.databaseName, 'secrets') : sealedKV('secrets')
  }
  get description(): string {
    if (this.uri) return `Control plane MongoDB (database ${this.databaseName})`
    return masterSecret().stable
      ? 'Control plane in cookie cifrato HttpOnly (AES-256-GCM, chiave da SESSION_SECRET)'
      : 'Control plane in cookie cifrato con chiave effimera (configurare SESSION_SECRET per la persistenza tra istanze)'
  }
}

let cp: ControlPlane | null = null
export function controlPlane(): ControlPlane {
  cp ??= new ControlPlane()
  return cp
}

export const DEFAULT_VOYAGE_MODEL = 'voyage-4'
export const DEFAULT_RERANK_MODEL = 'rerank-2.5'

function emptyStatus(): EnvironmentRecord['status'] {
  return {
    mongo: 'NOT_CONFIGURED',
    mongoMessage: null,
    mongoCheckedAt: null,
    voyage: 'NOT_CONFIGURED',
    voyageMessage: null,
    initializedAt: null,
    vectorIndex: 'NONE',
    vectorIndexMessage: null,
    kbEmbeddedModel: null,
  }
}

/** Built-in environments: the credential-free demo and (when MONGODB_URI is set) a development environment. */
export function builtInEnvironments(): EnvironmentRecord[] {
  const ts = '2026-10-01T00:00:00.000Z'
  const hasVoyageEnv = !!process.env.VOYAGE_API_KEY
  const list: EnvironmentRecord[] = [
    {
      environmentId: 'demo',
      name: 'Demo Environment',
      type: 'DEMO',
      ownerId: 'system',
      builtIn: true,
      mongo: null,
      voyage: { mode: 'simulated', apiKeySecretRef: hasVoyageEnv ? 'env://VOYAGE_API_KEY' : null, model: DEFAULT_VOYAGE_MODEL, rerankModel: null },
      status: { ...emptyStatus(), voyage: hasVoyageEnv ? 'UNTESTED' : 'NOT_CONFIGURED', initializedAt: ts },
      createdAt: ts,
      updatedAt: ts,
    },
  ]
  if (process.env.MONGODB_URI) {
    list.push({
      environmentId: 'development',
      name: 'Development Environment',
      type: 'DEVELOPMENT',
      ownerId: 'system',
      builtIn: true,
      mongo: {
        connectionSecretRef: 'env://MONGODB_URI',
        databaseName: process.env.MONGODB_DB ?? 'gacc_demo',
        host: null,
        connectionMode: process.env.MONGODB_URI.startsWith('mongodb+srv://') ? 'srv' : 'standard',
      },
      voyage: {
        mode: hasVoyageEnv ? 'voyage-api' : 'simulated',
        apiKeySecretRef: hasVoyageEnv ? 'env://VOYAGE_API_KEY' : null,
        model: process.env.VOYAGE_MODEL ?? DEFAULT_VOYAGE_MODEL,
        rerankModel: null,
      },
      status: { ...emptyStatus(), mongo: 'UNTESTED', voyage: hasVoyageEnv ? 'UNTESTED' : 'NOT_CONFIGURED' },
      createdAt: ts,
      updatedAt: ts,
    })
  }
  return list
}

/** Built-in environments may be overridden by persisted records (status, Voyage settings). */
export async function listEnvironments(ownerId: string): Promise<EnvironmentRecord[]> {
  const kv = await controlPlane().environments()
  const stored = await kv.find({})
  const builtIns = builtInEnvironments().map((b) => {
    const o = stored.find((s) => s.environmentId === b.environmentId)
    return o ? { ...b, voyage: { ...b.voyage, ...o.voyage, apiKeySecretRef: o.voyage.apiKeySecretRef ?? b.voyage.apiKeySecretRef }, status: o.status, updatedAt: o.updatedAt } : b
  })
  return [...builtIns, ...stored.filter((s) => !s.builtIn && s.ownerId === ownerId)]
}

export async function getEnvironment(environmentId: string, ownerId: string): Promise<EnvironmentRecord | null> {
  return (await listEnvironments(ownerId)).find((e) => e.environmentId === environmentId) ?? null
}

export async function saveEnvironment(env: EnvironmentRecord): Promise<void> {
  const kv = await controlPlane().environments()
  const existing = await kv.findOne({ environmentId: env.environmentId })
  const next = { ...env, updatedAt: new Date().toISOString() }
  if (existing) await kv.updateOne({ environmentId: env.environmentId }, next)
  else await kv.insertOne(next)
}

export async function deleteEnvironment(environmentId: string): Promise<void> {
  const kv = await controlPlane().environments()
  await kv.deleteOne({ environmentId })
}

export function newEnvironmentStatus(): EnvironmentRecord['status'] {
  return emptyStatus()
}
