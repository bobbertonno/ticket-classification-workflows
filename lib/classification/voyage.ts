/**
 * Server-side Voyage AI REST client. The API key is always passed in from server
 * context (env var or decrypted secret) and never serialized to the browser.
 */
const VOYAGE_BASE = 'https://api.voyageai.com/v1'

export class VoyageError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

async function voyagePost<T>(apiKey: string, path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${VOYAGE_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    })
  } catch (err) {
    throw new VoyageError(`Voyage AI non raggiungibile: ${(err as Error).message}`, null)
  }
  if (!res.ok) {
    const detail = res.status === 401 ? 'API key non valida' : res.status === 429 ? 'Rate limit superato' : `HTTP ${res.status}`
    throw new VoyageError(`Errore Voyage AI: ${detail}`, res.status)
  }
  return (await res.json()) as T
}

export interface VoyageEmbedResult {
  embeddings: number[][]
  model: string
  totalTokens: number
}

export async function voyageEmbed(
  apiKey: string,
  model: string,
  inputs: string[],
  inputType: 'query' | 'document',
): Promise<VoyageEmbedResult> {
  const r = await voyagePost<{ data: { embedding: number[]; index: number }[]; model: string; usage?: { total_tokens?: number } }>(
    apiKey,
    '/embeddings',
    { input: inputs, model, input_type: inputType },
  )
  const sorted = [...r.data].sort((a, b) => a.index - b.index)
  return { embeddings: sorted.map((d) => d.embedding), model: r.model, totalTokens: r.usage?.total_tokens ?? 0 }
}

export async function voyageRerank(
  apiKey: string,
  model: string,
  query: string,
  documents: string[],
): Promise<{ index: number; score: number }[]> {
  const r = await voyagePost<{ data: { index: number; relevance_score: number }[] }>(apiKey, '/rerank', {
    query,
    documents,
    model,
  })
  return r.data.map((d) => ({ index: d.index, score: d.relevance_score }))
}
