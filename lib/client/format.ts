const dt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const tm = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dd = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short' })

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—')
export const fmtTime = (iso: string | null | undefined) => (iso ? tm.format(new Date(iso)) : '—')
export const fmtDay = (iso: string) => dd.format(new Date(iso))

export function fmtDuration(fromIso: string, toIso?: string | null): string {
  const ms = Math.max(0, (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime())
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}g ${h % 24}h`
}

export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  if (min < 1) return `${Math.round(min * 60)}s`
  if (min < 120) return `${Math.round(min * 10) / 10} min`
  return `${Math.round((min / 60) * 10) / 10} h`
}

export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('it-IT')}%`)
export const fmtNum = (v: number) => v.toLocaleString('it-IT')

export const STATUS_LABELS: Record<string, string> = {
  PENDING: 'In attesa',
  RUNNING: 'In esecuzione',
  WAITING_FOR_HUMAN: 'Attesa umana',
  COMPLETED: 'Completato',
  FAILED: 'Fallito',
  RETRYING: 'Nuovo tentativo',
  CANCELLED: 'Annullato',
  NEW: 'Nuovo',
  CLASSIFYING: 'In classificazione',
  CLASSIFIED: 'Classificato',
  IN_PROGRESS: 'In lavorazione',
  WAITING_FOR_APPROVAL: 'In approvazione',
  RESOLVED: 'Risolto',
  CLOSED: 'Chiuso',
  ESCALATED: 'Escalation',
  APPROVED: 'Approvato',
  REJECTED: 'Rifiutato',
  CHANGES_REQUESTED: 'Modifiche richieste',
  CONSUMED: 'Consumato',
  DEAD_LETTER: 'Dead letter',
  SKIPPED_DUPLICATE: 'Duplicato ignorato',
  QUEUED: 'In coda',
  DELIVERED: 'Consegnato',
  WAITING: 'In attesa',
  SKIPPED: 'Saltato',
  SUCCESS: 'Successo',
  FAILURE: 'Errore',
  INFO: 'Info',
  ON_TRACK: 'Nei tempi',
  AT_RISK: 'A rischio',
  BREACHED: 'Scaduto',
  ACTIVE: 'Attivo',
  DRAFT: 'Bozza',
  DEPRECATED: 'Deprecato',
  NONE: 'Nessuna',
}

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand'

export const STATUS_TONE: Record<string, Tone> = {
  COMPLETED: 'success',
  CLOSED: 'success',
  RESOLVED: 'success',
  APPROVED: 'success',
  CONSUMED: 'success',
  DELIVERED: 'success',
  SUCCESS: 'success',
  ON_TRACK: 'success',
  ACTIVE: 'success',
  RUNNING: 'info',
  IN_PROGRESS: 'info',
  CLASSIFYING: 'info',
  CLASSIFIED: 'info',
  INFO: 'info',
  WAITING_FOR_HUMAN: 'warning',
  WAITING_FOR_APPROVAL: 'warning',
  WAITING: 'warning',
  RETRYING: 'warning',
  CHANGES_REQUESTED: 'warning',
  AT_RISK: 'warning',
  QUEUED: 'warning',
  ESCALATED: 'brand',
  FAILED: 'error',
  REJECTED: 'error',
  DEAD_LETTER: 'error',
  FAILURE: 'error',
  BREACHED: 'error',
}

export const MODE_LABELS: Record<string, string> = {
  AUTOMATED: 'Fully Automated',
  HITL: 'Human-in-the-Loop',
  MANUAL_TRIAGE: 'Manual Triage',
}

export const PRIORITY_LABELS: Record<string, string> = { LOW: 'Bassa', MEDIUM: 'Media', HIGH: 'Alta', CRITICAL: 'Critica' }

export const METHOD_LABELS: Record<string, string> = {
  VOYAGE_API_ATLAS_VECTOR_SEARCH: 'Voyage AI + Atlas Vector Search',
  VOYAGE_API_IN_MEMORY_SEARCH: 'Voyage AI (ricerca in memoria)',
  ATLAS_AUTO_EMBEDDING: 'Atlas Automated Embedding (Voyage AI)',
  SIMULATED_DETERMINISTIC: 'Simulazione deterministica',
  KEYWORD: 'Keyword',
  HYBRID: 'Hybrid',
}
