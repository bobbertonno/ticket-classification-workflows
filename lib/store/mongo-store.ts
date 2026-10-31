import 'server-only'
import { MongoClient, MongoServerError, type Db, type Document, type IndexDescription } from 'mongodb'
import type { CollectionName, Collections } from '@/lib/domain/schemas'
import type { Collection, DataStore, Filter, FindOptions } from './types'

const globalForMongo = globalThis as unknown as { __gaccMongoClients?: Map<string, Promise<MongoClient>> }

export function getMongoClient(uri: string): Promise<MongoClient> {
  globalForMongo.__gaccMongoClients ??= new Map()
  let p = globalForMongo.__gaccMongoClients.get(uri)
  if (!p) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 6000,
      connectTimeoutMS: 6000,
      maxPoolSize: 10,
      appName: 'generali-automation-control-center',
    })
    p = client.connect().catch((err: unknown) => {
      globalForMongo.__gaccMongoClients?.delete(uri)
      throw err
    })
    globalForMongo.__gaccMongoClients.set(uri, p)
  }
  return p
}

class MongoCollection<T extends Document> implements Collection<T> {
  constructor(private readonly db: Db, private readonly name: string) {}
  private get c() {
    return this.db.collection<T>(this.name)
  }

  async find(filter?: Filter<T>, opts?: FindOptions<T>): Promise<T[]> {
    let cursor = this.c.find((filter ?? {}) as never, { projection: { _id: 0 } })
    if (opts?.sort) cursor = cursor.sort({ [opts.sort.field]: opts.sort.dir })
    if (opts?.limit) cursor = cursor.limit(opts.limit)
    return (await cursor.toArray()) as unknown as T[]
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    return (await this.c.findOne(filter as never, { projection: { _id: 0 } })) as unknown as T | null
  }

  async insertOne(doc: T): Promise<boolean> {
    try {
      await this.c.insertOne({ ...doc } as never)
      return true
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) return false
      throw err
    }
  }

  async insertMany(docs: T[]): Promise<number> {
    if (docs.length === 0) return 0
    try {
      const r = await this.c.insertMany(docs.map((d) => ({ ...d })) as never, { ordered: false })
      return r.insertedCount
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) {
        return (err as unknown as { result?: { insertedCount?: number } }).result?.insertedCount ?? 0
      }
      throw err
    }
  }

  async updateOne(filter: Filter<T>, set: Partial<T>): Promise<boolean> {
    const r = await this.c.updateOne(filter as never, { $set: set } as never)
    return r.matchedCount > 0
  }

  async deleteMany(filter: Filter<T>): Promise<number> {
    const r = await this.c.deleteMany(filter as never)
    return r.deletedCount
  }

  async count(filter?: Filter<T>): Promise<number> {
    return this.c.countDocuments((filter ?? {}) as never)
  }
}

export class MongoStore implements DataStore {
  readonly kind = 'mongodb' as const
  readonly label: string
  constructor(readonly db: Db, readonly databaseName: string, host: string) {
    this.label = `MongoDB Atlas · ${host} / ${databaseName}`
  }
  collection<K extends CollectionName>(name: K): Collection<Collections[K]> {
    return new MongoCollection(this.db, name) as unknown as Collection<Collections[K]>
  }
}

export async function createMongoStore(uri: string, databaseName: string): Promise<MongoStore> {
  const client = await getMongoClient(uri)
  const host = safeHost(uri)
  return new MongoStore(client.db(databaseName), databaseName, host)
}

export function safeHost(uri: string): string {
  try {
    const u = new URL(uri)
    return u.hostname
  } catch {
    return 'host non valido'
  }
}

export const INDEXES: Record<CollectionName, IndexDescription[]> = {
  agencies: [{ key: { agencyId: 1 }, unique: true }, { key: { region: 1 } }],
  remedy_tickets: [
    { key: { ticketId: 1 }, unique: true },
    { key: { agencyId: 1 } },
    { key: { status: 1 } },
    { key: { createdAt: -1 } },
  ],
  workflow_definitions: [{ key: { workflowId: 1 }, unique: true }, { key: { category: 1 } }],
  workflow_instances: [
    { key: { instanceId: 1 }, unique: true },
    { key: { ticketId: 1 } },
    { key: { agencyId: 1 } },
    { key: { status: 1, nextRunAt: 1 } },
    { key: { createdAt: -1 } },
  ],
  workflow_events: [
    { key: { eventId: 1 }, unique: true },
    { key: { instanceId: 1, timestamp: 1 } },
    { key: { correlationId: 1 } },
  ],
  human_tasks: [
    { key: { taskId: 1 }, unique: true },
    { key: { assignedTo: 1 } },
    { key: { status: 1 } },
    { key: { dueAt: 1 } },
  ],
  kafka_messages: [
    { key: { eventId: 1 }, unique: true },
    { key: { topic: 1, timestamp: -1 } },
    { key: { correlationId: 1 } },
  ],
  workflow_classification_knowledge: [
    { key: { exampleId: 1 }, unique: true },
    { key: { category: 1 } },
    { key: { workflowId: 1 } },
    { key: { language: 1, active: 1 } },
  ],
  classification_results: [{ key: { classificationId: 1 }, unique: true }, { key: { ticketId: 1 } }],
  notifications: [{ key: { notificationId: 1 }, unique: true }, { key: { ticketId: 1 } }, { key: { timestamp: -1 } }],
  artifacts: [{ key: { artifactId: 1 }, unique: true }, { key: { ticketId: 1 } }],
  audit_logs: [
    { key: { eventId: 1 }, unique: true },
    { key: { timestamp: -1 } },
    { key: { ticketId: 1 } },
    { key: { agencyId: 1 } },
  ],
  app_settings: [{ key: { key: 1 }, unique: true }],
}

export async function ensureIndexes(store: MongoStore): Promise<string[]> {
  const created: string[] = []
  for (const [name, indexes] of Object.entries(INDEXES)) {
    await store.db.collection(name).createIndexes(indexes)
    created.push(`${name} (${indexes.length})`)
  }
  return created
}
