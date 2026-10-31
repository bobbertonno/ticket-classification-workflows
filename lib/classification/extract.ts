import type { Category } from '@/lib/domain/schemas'
import { normalizeText } from './text'

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

export type ExtractedParameters = Record<string, string | number | boolean>

export function extractParameters(category: Category, subject: string, description: string, now = new Date()): ExtractedParameters {
  const text = normalizeText(`${subject} ${description}`)
  const params: ExtractedParameters = {}

  const monthIdx = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(text))
  const yearMatch = text.match(/\b(20[2-3][0-9])\b/)
  if (monthIdx >= 0) {
    params.periodMonth = monthIdx + 1
    params.periodYear = yearMatch ? Number(yearMatch[1]) : now.getFullYear()
    params.periodLabel = `${MONTHS[monthIdx]} ${params.periodYear}`
  } else if (/mese scorso|ultimo mese/.test(text)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    params.periodMonth = d.getMonth() + 1
    params.periodYear = d.getFullYear()
    params.periodLabel = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  }

  if (/excel|xlsx|foglio di calcolo/.test(text)) params.outputFormat = 'XLSX'
  else if (/\bpdf\b/.test(text)) params.outputFormat = 'PDF'

  if (/\baperti\b|\baperte\b|pendenti|non ancora chiuse/.test(text)) params.claimStatusFilter = 'APERTO'

  const policy = text.match(/polizz\w*\s+(?:n(?:umero|r)?\s+)?(\d{6,10})/) ?? text.match(/\b(\d{6,10})\b/)
  if (policy && (category === 'POLICY_DOCUMENT_RETRIEVAL' || category === 'DOCUMENT_GENERATION')) params.policyId = policy[1]

  if (category === 'ACCESS_PROVISIONING') {
    const portal = text.match(/portale\s+(sinistri|agenzie|polizze|liquidazioni)/)
    params.requestedAccess = portal ? `Portale ${portal[1]}` : /gestionale polizze/.test(text) ? 'Gestionale polizze' : 'Portale agenzie'
    params.accessLevel = /lettura/.test(text) ? 'READ_ONLY' : 'OPERATOR'
    params.beneficiary = /collaboratore|collega|dipendente|stagista|addetto/.test(text) ? 'Nuovo collaboratore (da censire)' : 'Utente indicato'
  }

  return params
}
