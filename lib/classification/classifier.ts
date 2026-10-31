import { z } from 'zod'
import { CATEGORY_WORKFLOW, POLICIES } from '@/lib/domain/seed-data'
import { CategorySchema, type AppSettings, type Category, type ClassificationResult, type SemanticMatch } from '@/lib/domain/schemas'
import { randomId } from '@/lib/domain/ids'
import type { DataStore } from '@/lib/store/types'
import { extractParameters } from './extract'
import { keywordClassify } from './keyword'
import { SimulatedRetriever, type Retriever } from './retriever'
import { normalizeText } from './text'

export interface DecisionPolicy {
  minTopScore: number
  minMargin: number
  topK: number
}

export interface Decision {
  category: Category
  humanReviewRequired: boolean
  rule: string
  categoryScores: { category: Category; score: number }[]
}

/**
 * Deterministic decision rules over retrieval evidence.
 * Scores are raw similarities (not calibrated probabilities).
 */
export function decideCategory(matches: SemanticMatch[], policy: DecisionPolicy): Decision {
  const byCat = new Map<Category, { max: number; count: number }>()
  for (const m of matches) {
    const s = m.rerankScore ?? m.score
    const cur = byCat.get(m.category) ?? { max: 0, count: 0 }
    byCat.set(m.category, { max: Math.max(cur.max, s), count: cur.count + 1 })
  }
  const categoryScores = [...byCat.entries()]
    .map(([category, v]) => ({ category, score: Math.round((v.max + 0.02 * (v.count - 1)) * 10000) / 10000 }))
    .sort((a, b) => b.score - a.score)

  const top = categoryScores[0]
  const second = categoryScores[1]
  if (!top) return { category: 'UNKNOWN', humanReviewRequired: true, rule: 'NO_MATCHES → triage manuale', categoryScores }
  if (top.category === 'UNKNOWN')
    return { category: 'UNKNOWN', humanReviewRequired: true, rule: 'TOP_MATCH_UNKNOWN → triage manuale', categoryScores }
  if (top.score < policy.minTopScore)
    return {
      category: 'UNKNOWN',
      humanReviewRequired: true,
      rule: `LOW_SIMILARITY: ${top.score.toFixed(3)} < soglia ${policy.minTopScore} → triage manuale`,
      categoryScores,
    }
  const margin = second ? top.score - second.score : 1
  if (margin < policy.minMargin)
    return {
      category: 'UNKNOWN',
      humanReviewRequired: true,
      rule: `AMBIGUOUS: margine ${margin.toFixed(3)} < ${policy.minMargin} tra ${top.category} e ${second?.category} → triage manuale`,
      categoryScores,
    }
  return {
    category: top.category,
    humanReviewRequired: false,
    rule: `ACCEPT: score ${top.score.toFixed(3)} ≥ ${policy.minTopScore}, margine ${margin.toFixed(3)} ≥ ${policy.minMargin}`,
    categoryScores,
  }
}

export const ClassificationOutputSchema = z.object({
  selectedCategory: CategorySchema,
  selectedWorkflow: z.string().min(1),
  semanticMatches: z
    .array(z.object({ exampleId: z.string(), category: CategorySchema, score: z.number().min(-1).max(1.0001) }).passthrough())
    .max(20),
  humanReviewRequired: z.boolean(),
  extractedParameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
})

export interface ClassifyInput {
  ticketId: string
  instanceId: string | null
  agencyId: string
  subject: string
  description: string
}

export async function classifyRequest(
  store: DataStore,
  retriever: Retriever,
  input: ClassifyInput,
  settings: AppSettings,
): Promise<ClassificationResult> {
  const normalizedText = normalizeText(`${input.subject}. ${input.description}`)
  const agency = await store.collection('agencies').findOne({ agencyId: input.agencyId })

  let active: Retriever = retriever
  let fallbackReason: string | null = null
  let matches: SemanticMatch[]
  try {
    matches = await active.search(normalizedText, settings.decisionPolicy.topK)
    if (active.rerank && active.rerankModel) matches = await active.rerank(normalizedText, matches)
  } catch (err) {
    fallbackReason = `Provider semantico non disponibile (${(err as Error).message}). Utilizzato classificatore deterministico di fallback.`
    active = new SimulatedRetriever(store)
    matches = await active.search(normalizedText, settings.decisionPolicy.topK)
  }

  const decision = decideCategory(matches, settings.decisionPolicy)
  const extractedParameters = extractParameters(decision.category, input.subject, input.description)

  const reasons: string[] = []
  let authorized = true
  if (!agency) {
    authorized = false
    reasons.push(`Agenzia ${input.agencyId} non presente nell’anagrafica autoritativa`)
  } else if (agency.status !== 'ACTIVE') {
    authorized = false
    reasons.push(`Agenzia ${agency.agencyId} non attiva`)
  } else {
    reasons.push(`Agenzia ${agency.agencyId} attiva (metadati autoritativi Remedy)`)
  }
  if (decision.category === 'POLICY_DOCUMENT_RETRIEVAL' && typeof extractedParameters.policyId === 'string') {
    const policy = POLICIES.find((p) => p.policyId === extractedParameters.policyId)
    if (!policy) reasons.push(`Polizza ${extractedParameters.policyId} non trovata: verifica nello step di autorizzazione`)
    else if (policy.agencyId !== input.agencyId) {
      authorized = false
      reasons.push(`Polizza ${policy.policyId} non appartiene all’agenzia ${input.agencyId}`)
    } else reasons.push(`Polizza ${policy.policyId} associata all’agenzia richiedente`)
  }

  const workflowId = CATEGORY_WORKFLOW[decision.category]
  const definition = await store.collection('workflow_definitions').findOne({ workflowId })
  const approvalRequired =
    !!definition?.approvalPolicy.required && settings.approvalPolicies[decision.category] !== false

  const parsed = ClassificationOutputSchema.parse({
    selectedCategory: decision.category,
    selectedWorkflow: workflowId,
    semanticMatches: matches,
    humanReviewRequired: decision.humanReviewRequired,
    extractedParameters,
  })

  return {
    classificationId: randomId('CLS'),
    ticketId: input.ticketId,
    instanceId: input.instanceId,
    agencyId: input.agencyId,
    normalizedText,
    selectedCategory: parsed.selectedCategory,
    selectedWorkflow: parsed.selectedWorkflow,
    semanticMatches: matches,
    categoryScores: decision.categoryScores,
    similarityScores: matches.map((m) => m.score),
    method: active.method,
    simulated: active.simulated,
    modelName: active.modelName,
    modelVersion: null,
    rerankModel: active.rerankModel,
    classificationTimestamp: new Date().toISOString(),
    extractedParameters: parsed.extractedParameters,
    policyDecision: {
      authorized,
      reasons,
      approvalRequired,
      rule: approvalRequired ? `Approvazione richiesta da policy ${workflowId}` : 'Nessuna approvazione richiesta',
    },
    humanReviewRequired: decision.humanReviewRequired || !authorized,
    decisionRule: authorized ? decision.rule : `${decision.rule}; NON AUTORIZZATO → revisione umana`,
    fallbackReason,
  }
}

export interface ComparisonResult {
  keyword: { category: Category; matchedKeywords: string[]; scores: { category: Category; score: number }[] }
  semantic: { category: Category; rule: string; matches: SemanticMatch[]; method: string; simulated: boolean; modelName: string; fallbackReason: string | null }
  hybrid: { category: Category; scores: { category: Category; score: number }[]; rule: string }
}

export async function compareMethods(
  store: DataStore,
  retriever: Retriever,
  text: string,
  settings: AppSettings,
): Promise<ComparisonResult> {
  const normalized = normalizeText(text)
  const kw = keywordClassify(normalized)
  let active = retriever
  let fallbackReason: string | null = null
  let matches: SemanticMatch[]
  try {
    matches = await active.search(normalized, settings.decisionPolicy.topK)
  } catch (err) {
    fallbackReason = (err as Error).message
    active = new SimulatedRetriever(store)
    matches = await active.search(normalized, settings.decisionPolicy.topK)
  }
  const sem = decideCategory(matches, settings.decisionPolicy)

  const cats = new Set<Category>([...kw.scores.map((s) => s.category), ...sem.categoryScores.map((s) => s.category)])
  const hybridScores = [...cats]
    .map((category) => {
      const k = kw.scores.find((s) => s.category === category)?.score ?? 0
      const s = sem.categoryScores.find((x) => x.category === category)?.score ?? 0
      return { category, score: Math.round((0.7 * s + 0.3 * k) * 10000) / 10000 }
    })
    .sort((a, b) => b.score - a.score)
  const hTop = hybridScores[0]
  const hybridCategory: Category = hTop && hTop.score >= settings.decisionPolicy.minTopScore * 0.7 ? hTop.category : 'UNKNOWN'

  return {
    keyword: { category: kw.category, matchedKeywords: kw.matchedKeywords, scores: kw.scores.slice(0, 5) },
    semantic: {
      category: sem.category,
      rule: sem.rule,
      matches,
      method: active.method,
      simulated: active.simulated,
      modelName: active.modelName,
      fallbackReason,
    },
    hybrid: { category: hybridCategory, scores: hybridScores.slice(0, 5), rule: '0.7 × semantico + 0.3 × keyword' },
  }
}
