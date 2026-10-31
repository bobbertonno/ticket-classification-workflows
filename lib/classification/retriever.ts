import type { ClassificationMethod, KnowledgeExample, SemanticMatch } from '@/lib/domain/schemas'
import type { DataStore } from '@/lib/store/types'
import { cosine, simulatedEmbedding } from './text'
import { voyageEmbed, voyageRerank } from './voyage'

export interface Retriever {
  method: ClassificationMethod
  simulated: boolean
  modelName: string
  rerankModel: string | null
  description: string
  search(text: string, topK: number): Promise<SemanticMatch[]>
  rerank?(text: string, matches: SemanticMatch[]): Promise<SemanticMatch[]>
}

function toMatch(e: KnowledgeExample, score: number): SemanticMatch {
  return {
    exampleId: e.exampleId,
    category: e.category,
    subcategory: e.subcategory,
    workflowId: e.workflowId,
    exampleRequest: e.exampleRequest,
    score: Math.round(score * 10000) / 10000,
  }
}

const simulatedCache = new Map<string, number[]>()

export class SimulatedRetriever implements Retriever {
  readonly method = 'SIMULATED_DETERMINISTIC' as const
  readonly simulated = true
  readonly modelName = 'gacc-simulated-hash-512 (non Voyage AI)'
  readonly rerankModel = null
  readonly description = 'Embedding deterministico simulato (feature hashing + dizionario concetti). Nessuna chiamata a Voyage AI.'
  constructor(private readonly store: DataStore) {}

  async search(text: string, topK: number): Promise<SemanticMatch[]> {
    const kb = await this.store.collection('workflow_classification_knowledge').find({ active: true })
    const q = simulatedEmbedding(text)
    return kb
      .map((e) => {
        let emb = simulatedCache.get(e.exampleRequest)
        if (!emb) {
          emb = simulatedEmbedding(e.exampleRequest)
          simulatedCache.set(e.exampleRequest, emb)
        }
        return toMatch(e, cosine(q, emb))
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}

/** Real Voyage AI query embeddings + cosine over stored Voyage document embeddings (no Atlas index required). */
export class VoyageInMemoryRetriever implements Retriever {
  readonly method = 'VOYAGE_API_IN_MEMORY_SEARCH' as const
  readonly simulated = false
  readonly description: string
  constructor(
    private readonly store: DataStore,
    private readonly apiKey: string,
    readonly modelName: string,
    readonly rerankModel: string | null,
  ) {
    this.description = `Voyage AI (${modelName}) via API esterna; similarità coseno calcolata lato server sugli embedding memorizzati.`
  }

  async search(text: string, topK: number): Promise<SemanticMatch[]> {
    const kb = (await this.store.collection('workflow_classification_knowledge').find({ active: true })).filter(
      (e) => Array.isArray(e.embedding) && e.embeddingModel === this.modelName,
    )
    if (kb.length === 0) throw new Error('Knowledge base non indicizzata con Voyage AI: eseguire l’inizializzazione dal Setup Wizard.')
    const { embeddings } = await voyageEmbed(this.apiKey, this.modelName, [text], 'query')
    const q = embeddings[0]
    return kb
      .map((e) => toMatch(e, cosine(q, e.embedding as number[])))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  async rerank(text: string, matches: SemanticMatch[]): Promise<SemanticMatch[]> {
    return rerankWithVoyage(this.apiKey, this.rerankModel, text, matches)
  }
}

export async function rerankWithVoyage(
  apiKey: string,
  model: string | null,
  text: string,
  matches: SemanticMatch[],
): Promise<SemanticMatch[]> {
  if (!model || matches.length === 0) return matches
  const ranked = await voyageRerank(apiKey, model, text, matches.map((m) => m.exampleRequest))
  return ranked
    .map((r) => ({ ...matches[r.index], rerankScore: Math.round(r.score * 10000) / 10000 }))
    .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
}
