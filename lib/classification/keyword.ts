import type { Category } from '@/lib/domain/schemas'
import { normalizeText } from './text'

/** Classic rule-based keyword classifier, used for the comparison view. */
const KEYWORDS: Record<Exclude<Category, 'UNKNOWN'>, string[]> = {
  CLAIMS_REPORT: ['report sinistri', 'excel', 'sinistri aperti', 'estrazione sinistri', 'xlsx'],
  POLICY_DOCUMENT_RETRIEVAL: ['copia polizza', 'pdf della polizza', 'copia pdf', 'documento di polizza', 'polizza'],
  ACCESS_PROVISIONING: ['abilitazione', 'accesso', 'credenziali', 'utenza', 'permessi'],
  CUSTOMER_DATA_UPDATE: ['anagrafica', 'cambio indirizzo', 'iban', 'aggiornare dati'],
  CLAIM_STATUS_INQUIRY: ['stato sinistro', 'stato della pratica', 'a che punto', 'liquidato'],
  PAYMENT_REPORT: ['incassi', 'pagamenti', 'provvigioni', 'insoluti'],
  DOCUMENT_GENERATION: ['attestato', 'certificato', 'dichiarazione', 'carta verde'],
  TECHNICAL_SUPPORT: ['errore', 'non funziona', 'non viene generato', 'bloccato', 'timeout'],
  COMPLIANCE_REQUEST: ['gdpr', 'privacy', 'antiriciclaggio', 'ivass', 'reclamo'],
}

export interface KeywordResult {
  category: Category
  scores: { category: Category; score: number }[]
  matchedKeywords: string[]
}

export function keywordClassify(text: string): KeywordResult {
  const t = normalizeText(text)
  const scores: { category: Category; score: number }[] = []
  const matched: string[] = []
  for (const [category, kws] of Object.entries(KEYWORDS) as [Category, string[]][]) {
    const hits = kws.filter((k) => t.includes(k))
    matched.push(...hits.map((h) => `${category}:${h}`))
    scores.push({ category, score: Math.min(1, hits.length / 2) })
  }
  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  const tie = scores[1] && scores[1].score === top.score
  return {
    category: top.score === 0 || tie ? 'UNKNOWN' : top.category,
    scores,
    matchedKeywords: matched,
  }
}
