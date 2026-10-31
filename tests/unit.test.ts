import { describe, expect, it } from 'vitest'
import { decideCategory } from '@/lib/classification/classifier'
import { keywordClassify } from '@/lib/classification/keyword'
import { normalizeText } from '@/lib/classification/text'
import { canDecide, publishTicketEvent } from '@/lib/engine/engine'
import type { SemanticMatch } from '@/lib/domain/schemas'
import { approver, freshDeps, presenter, viewer } from './helpers'

const match = (category: SemanticMatch['category'], score: number): SemanticMatch => ({
  exampleId: `${category}-${score}`,
  category,
  subcategory: 'test',
  workflowId: 'WF-TEST',
  exampleRequest: 'esempio',
  score,
})

describe('classification routing', () => {
  it('keyword classifier routes an Excel claims request to CLAIMS_REPORT', () => {
    const r = keywordClassify(normalizeText('Mi serve un Excel con tutti i sinistri aperti a settembre 2026'))
    expect(r.category).toBe('CLAIMS_REPORT')
  })

  it('selects the dominant category when score and margin pass the policy', () => {
    const d = decideCategory([match('POLICY_DOCUMENT_RETRIEVAL', 0.82), match('POLICY_DOCUMENT_RETRIEVAL', 0.8), match('CLAIMS_REPORT', 0.41)], { minTopScore: 0.5, minMargin: 0.05, topK: 5 })
    expect(d.category).toBe('POLICY_DOCUMENT_RETRIEVAL')
    expect(d.humanReviewRequired).toBe(false)
  })

  it('routes low-similarity requests to manual triage', () => {
    const d = decideCategory([match('CLAIMS_REPORT', 0.2), match('PAYMENT_REPORT', 0.19)], { minTopScore: 0.5, minMargin: 0.05, topK: 5 })
    expect(d.category).toBe('UNKNOWN')
    expect(d.humanReviewRequired).toBe(true)
  })

  it('routes ambiguous requests (insufficient margin) to manual triage', () => {
    const d = decideCategory([match('CLAIMS_REPORT', 0.71), match('PAYMENT_REPORT', 0.7)], { minTopScore: 0.5, minMargin: 0.05, topK: 5 })
    expect(d.humanReviewRequired).toBe(true)
  })
})

describe('authorization', () => {
  it('only admins and matching approvers may decide tasks', () => {
    expect(canDecide(presenter, { assignedRole: 'approver' })).toBe(true)
    expect(canDecide(approver, { assignedRole: 'approver' })).toBe(true)
    expect(canDecide(approver, { assignedRole: 'admin' })).toBe(false)
    expect(canDecide(viewer, { assignedRole: 'approver' })).toBe(false)
  })
})

describe('idempotency', () => {
  it('ignores a repeated eventId and creates a single workflow instance', async () => {
    const deps = await freshDeps()
    const input = {
      topic: 'remedy.ticket.created' as const,
      agencyId: 'RM014',
      operatorName: 'Test',
      priority: 'MEDIUM' as const,
      subject: 'Copia polizza',
      description: 'Ho bisogno della copia PDF della polizza 987654.',
      eventId: 'EVT-IDEMPOTENCY-0001',
    }
    const before = await deps.store.collection('workflow_instances').count()
    const first = await publishTicketEvent(deps, input, presenter)
    const second = await publishTicketEvent(deps, input, presenter)
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(await deps.store.collection('workflow_instances').count()).toBe(before + 1)
    expect(await deps.store.collection('kafka_messages').count({ eventId: input.eventId })).toBe(1)
  })
})
