import { hash32, prng } from '@/lib/domain/ids'
import { POLICIES } from '@/lib/domain/seed-data'

export interface ClaimRow {
  claimId: string
  agencyId: string
  policyId: string
  openingDate: string
  claimType: string
  claimStatus: string
  amount: number
}

const CLAIM_TYPES = ['RC Auto', 'Furto', 'Incendio', 'Danni da acqua', 'Infortuni', 'Grandine', 'RC Generale', 'Cristalli']
const CLAIM_STATUSES = ['APERTO', 'IN PERIZIA', 'IN LIQUIDAZIONE']

export function syntheticClaims(agencyId: string, year: number, month: number): ClaimRow[] {
  const rnd = prng(hash32(`claims:${agencyId}:${year}:${month}`))
  const n = 18 + Math.floor(rnd() * 22)
  const daysInMonth = new Date(year, month, 0).getDate()
  return Array.from({ length: n }, (_, i) => {
    const day = 1 + Math.floor(rnd() * daysInMonth)
    return {
      claimId: `SIN-${year}${String(month).padStart(2, '0')}-${agencyId}-${String(i + 1).padStart(3, '0')}`,
      agencyId,
      policyId: String(100000 + Math.floor(rnd() * 899999)),
      openingDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      claimType: CLAIM_TYPES[Math.floor(rnd() * CLAIM_TYPES.length)],
      claimStatus: CLAIM_STATUSES[Math.floor(rnd() * CLAIM_STATUSES.length)],
      amount: Math.round((300 + rnd() * 24000) * 100) / 100,
    }
  }).sort((a, b) => a.openingDate.localeCompare(b.openingDate))
}

export interface PaymentRow {
  paymentId: string
  agencyId: string
  policyId: string
  paymentDate: string
  method: string
  status: string
  amount: number
}

export function syntheticPayments(agencyId: string, year: number, month: number): PaymentRow[] {
  const rnd = prng(hash32(`payments:${agencyId}:${year}:${month}`))
  const n = 25 + Math.floor(rnd() * 30)
  const methods = ['SDD', 'Bonifico', 'Carta', 'POS agenzia']
  const statuses = ['INCASSATO', 'INCASSATO', 'INCASSATO', 'INSOLUTO']
  return Array.from({ length: n }, (_, i) => ({
    paymentId: `PAY-${year}${String(month).padStart(2, '0')}-${agencyId}-${String(i + 1).padStart(4, '0')}`,
    agencyId,
    policyId: String(100000 + Math.floor(rnd() * 899999)),
    paymentDate: `${year}-${String(month).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`,
    method: methods[Math.floor(rnd() * methods.length)],
    status: statuses[Math.floor(rnd() * statuses.length)],
    amount: Math.round((80 + rnd() * 2400) * 100) / 100,
  }))
}

export function findPolicy(policyId: string) {
  return POLICIES.find((p) => p.policyId === policyId) ?? null
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export type ArtifactParams = Record<string, string | number>

/** Canonical content (data rows) used for integrity hashing; independent of file container timestamps. */
export function artifactContent(kind: string, params: ArtifactParams): { rows: unknown[]; rowCount: number } {
  const agencyId = String(params.agencyId)
  if (kind === 'CLAIMS_XLSX') {
    const rows = syntheticClaims(agencyId, Number(params.year), Number(params.month))
    return { rows, rowCount: rows.length }
  }
  if (kind === 'PAYMENTS_XLSX') {
    const rows = syntheticPayments(agencyId, Number(params.year), Number(params.month))
    return { rows, rowCount: rows.length }
  }
  return { rows: [params], rowCount: 1 }
}
