import type { CollectionName, Collections } from '@/lib/domain/schemas'

export type FilterValue<V> = V | { $in: V[] }
export type Filter<T> = { [K in keyof T]?: FilterValue<T[K]> }

export interface FindOptions<T> {
  sort?: { field: keyof T & string; dir: 1 | -1 }
  limit?: number
}

export interface Collection<T> {
  find(filter?: Filter<T>, opts?: FindOptions<T>): Promise<T[]>
  findOne(filter: Filter<T>): Promise<T | null>
  /** Returns false when a document with the same unique key already exists (idempotent insert). */
  insertOne(doc: T): Promise<boolean>
  insertMany(docs: T[]): Promise<number>
  /** Conditional atomic update: only applies when the filter matches (used for optimistic concurrency). */
  updateOne(filter: Filter<T>, set: Partial<T>): Promise<boolean>
  deleteMany(filter: Filter<T>): Promise<number>
  count(filter?: Filter<T>): Promise<number>
}

export interface DataStore {
  kind: 'memory' | 'mongodb'
  label: string
  databaseName: string
  collection<K extends CollectionName>(name: K): Collection<Collections[K]>
}
