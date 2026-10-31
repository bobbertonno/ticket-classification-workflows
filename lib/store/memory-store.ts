import { UNIQUE_KEYS, type CollectionName, type Collections } from '@/lib/domain/schemas'
import type { Collection, DataStore, Filter, FindOptions } from './types'

function matches<T>(doc: T, filter: Filter<T> | undefined): boolean {
  if (!filter) return true
  for (const key of Object.keys(filter) as (keyof T)[]) {
    const expected = filter[key]
    const actual = doc[key]
    if (expected !== null && typeof expected === 'object' && '$in' in (expected as object)) {
      if (!(expected as { $in: unknown[] }).$in.includes(actual)) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

class MemoryCollection<T extends object> implements Collection<T> {
  private readonly docs = new Map<string, T>()
  constructor(private readonly uniqueKey: keyof T & string) {}

  async find(filter?: Filter<T>, opts?: FindOptions<T>): Promise<T[]> {
    let result = [...this.docs.values()].filter((d) => matches(d, filter))
    if (opts?.sort) {
      const { field, dir } = opts.sort
      result.sort((a, b) => {
        const av = a[field] as unknown as string | number
        const bv = b[field] as unknown as string | number
        return av < bv ? -dir : av > bv ? dir : 0
      })
    }
    if (opts?.limit) result = result.slice(0, opts.limit)
    return result.map((d) => structuredClone(d))
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    for (const d of this.docs.values()) if (matches(d, filter)) return structuredClone(d)
    return null
  }

  async insertOne(doc: T): Promise<boolean> {
    const key = String(doc[this.uniqueKey])
    if (this.docs.has(key)) return false
    this.docs.set(key, structuredClone(doc))
    return true
  }

  async insertMany(docs: T[]): Promise<number> {
    let n = 0
    for (const d of docs) if (await this.insertOne(d)) n++
    return n
  }

  async updateOne(filter: Filter<T>, set: Partial<T>): Promise<boolean> {
    for (const [key, d] of this.docs.entries()) {
      if (matches(d, filter)) {
        this.docs.set(key, { ...d, ...structuredClone(set) })
        return true
      }
    }
    return false
  }

  async deleteMany(filter: Filter<T>): Promise<number> {
    let n = 0
    for (const [key, d] of [...this.docs.entries()]) {
      if (matches(d, filter)) {
        this.docs.delete(key)
        n++
      }
    }
    return n
  }

  async count(filter?: Filter<T>): Promise<number> {
    let n = 0
    for (const d of this.docs.values()) if (matches(d, filter)) n++
    return n
  }
}

export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const
  readonly label = 'Simulatore in-memory (non persistente)'
  readonly databaseName = 'demo-in-memory'
  private readonly collections = new Map<CollectionName, MemoryCollection<object>>()

  collection<K extends CollectionName>(name: K): Collection<Collections[K]> {
    let c = this.collections.get(name)
    if (!c) {
      c = new MemoryCollection<object>(UNIQUE_KEYS[name] as never)
      this.collections.set(name, c)
    }
    return c as unknown as Collection<Collections[K]>
  }
}

const globalForMemory = globalThis as unknown as { __gaccMemoryStores?: Map<string, MemoryStore> }

/** One in-memory store per demo scope. Lives for the lifetime of the server instance only. */
export function getMemoryStore(scope: string): MemoryStore {
  globalForMemory.__gaccMemoryStores ??= new Map()
  let store = globalForMemory.__gaccMemoryStores.get(scope)
  if (!store) {
    store = new MemoryStore()
    globalForMemory.__gaccMemoryStores.set(scope, store)
  }
  return store
}
