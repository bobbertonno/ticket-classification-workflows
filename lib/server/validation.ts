import { z } from 'zod'

const RESERVED_DBS = new Set(['admin', 'local', 'config'])
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|metadata\.google|.*\.internal$)/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

export const DatabaseNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,38}$/, 'Nome database: 1-38 caratteri alfanumerici, "_" o "-"')
  .refine((n) => !RESERVED_DBS.has(n.toLowerCase()), 'I database di sistema (admin, local, config) non sono consentiti')

export interface UriValidation {
  ok: boolean
  error?: string
  host?: string
  mode?: 'srv' | 'standard'
}

/**
 * SSRF guard for user-supplied MongoDB destinations: only Atlas SRV hostnames (*.mongodb.net) are
 * allowed unless ALLOW_NON_ATLAS_MONGODB=true is set server-side for development.
 */
export function validateMongoUri(uri: string, controlPlaneDb?: string, dbName?: string): UriValidation {
  if (uri.length > 1024) return { ok: false, error: 'Connection string troppo lunga' }
  const isSrv = uri.startsWith('mongodb+srv://')
  if (!isSrv && !uri.startsWith('mongodb://')) return { ok: false, error: 'La connection string deve iniziare con mongodb+srv:// o mongodb://' }
  let url: URL
  try {
    url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'))
  } catch {
    return { ok: false, error: 'Connection string non valida' }
  }
  const hosts = (url.host ? [url.hostname] : []).concat(isSrv ? [] : uri.replace(/^mongodb:\/\/([^@]*@)?/, '').split('/')[0].split(',').map((h) => h.split(':')[0]))
  const allowNonAtlas = process.env.ALLOW_NON_ATLAS_MONGODB === 'true'
  for (const h of hosts) {
    if (!h) return { ok: false, error: 'Host mancante nella connection string' }
    if (!allowNonAtlas) {
      if (PRIVATE_HOST.test(h) || IPV4.test(h)) return { ok: false, error: `Destinazione non consentita: ${h} (indirizzi privati/IP bloccati)` }
      if (!h.toLowerCase().endsWith('.mongodb.net')) return { ok: false, error: `Sono consentiti solo cluster MongoDB Atlas (*.mongodb.net). Host ricevuto: ${h}` }
    }
  }
  if (!url.username || !url.password) return { ok: false, error: 'Specificare utente e password di un utente database dedicato (least privilege)' }
  if (controlPlaneDb && dbName && controlPlaneDb === dbName) return { ok: false, error: 'Il database dati non può coincidere con il database del control plane' }
  return { ok: true, host: url.hostname, mode: isSrv ? 'srv' : 'standard' }
}

export const MongoConfigSchema = z.object({
  connectionString: z.string().min(12).max(1024),
  databaseName: DatabaseNameSchema,
})

export const VoyageConfigSchema = z.object({
  mode: z.enum(['simulated', 'voyage-api', 'atlas-auto']),
  apiKey: z.string().min(10).max(200).optional(),
  model: z.enum(['voyage-4', 'voyage-4-large', 'voyage-4-lite', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-multilingual-2']).default('voyage-4'),
  rerankModel: z.enum(['rerank-2.5', 'rerank-2.5-lite']).nullable().default(null),
})
