import { describe, expect, it } from 'vitest'
import { decideTask, publishTicketEvent, retryInstance, runInstance } from '@/lib/engine/engine'
import type { Priority } from '@/lib/domain/schemas'
import { approver, freshDeps, presenter, viewer } from './helpers'

const ticket = (agencyId: string, description: string, priority: Priority = 'MEDIUM') => ({
  topic: 'remedy.ticket.created' as const,
  agencyId,
  operatorName: 'Operatore Test',
  priority,
  subject: description.slice(0, 60),
  description,
})

async function load(deps: Awaited<ReturnType<typeof freshDeps>>, instanceId: string) {
  const inst = await deps.store.collection('workflow_instances').findOne({ instanceId })
  if (!inst) throw new Error('instance missing')
  const t = await deps.store.collection('remedy_tickets').findOne({ ticketId: inst.ticketId })
  return { inst, ticket: t! }
}

describe('simulated ticket lifecycle', () => {
  it('Scenario B: fully automated policy retrieval closes the ticket with one notification and artifact', async () => {
    const deps = await freshDeps()
    const r = await publishTicketEvent(deps, ticket('RM014', 'Ho bisogno della copia PDF della polizza 987654.'), presenter)
    await runInstance(deps, r.instanceId!)
    const { inst, ticket: t } = await load(deps, r.instanceId!)
    expect(inst.status).toBe('COMPLETED')
    expect(t.status).toBe('CLOSED')
    expect(t.agencyId).toBe('RM014')
    expect(inst.agencyId).toBe('RM014')
    const notes = await deps.store.collection('notifications').find({ instanceId: inst.instanceId })
    expect(notes.filter((n) => n.channel === 'EMAIL')).toHaveLength(1)
    expect(await deps.store.collection('artifacts').count({ instanceId: inst.instanceId })).toBe(1)
  })

  it('Scenario A: HITL claims report pauses for approval, then resumes and closes', async () => {
    const deps = await freshDeps()
    const r = await publishTicketEvent(deps, ticket('MI001', 'Mi serve un Excel con tutti i sinistri aperti a settembre 2026 per la mia agenzia.'), presenter)
    await runInstance(deps, r.instanceId!)
    let state = await load(deps, r.instanceId!)
    expect(state.inst.status).toBe('WAITING_FOR_HUMAN')
    expect(state.ticket.status).toBe('WAITING_FOR_APPROVAL')

    const task = await deps.store.collection('human_tasks').findOne({ instanceId: r.instanceId!, status: 'PENDING' })
    expect(task).not.toBeNull()
    await expect(decideTask(deps, task!.taskId, { decision: 'APPROVED', comment: 'no' }, viewer)).rejects.toThrow()

    await decideTask(deps, task!.taskId, { decision: 'APPROVED', comment: 'Report verificato' }, approver)
    await runInstance(deps, r.instanceId!)
    state = await load(deps, r.instanceId!)
    expect(state.inst.status).toBe('COMPLETED')
    expect(state.ticket.status).toBe('CLOSED')
    const artifacts = await deps.store.collection('artifacts').find({ instanceId: r.instanceId! })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].mimeType).toContain('spreadsheet')
    const audit = await deps.store.collection('audit_logs').find({ instanceId: r.instanceId! })
    expect(audit.length).toBeGreaterThan(3)
  })

  it('Scenario C: rejection follows the configured rejection path and never closes as resolved', async () => {
    const deps = await freshDeps()
    const r = await publishTicketEvent(deps, ticket('TO008', "Richiedo l'abilitazione al portale sinistri per un nuovo collaboratore."), presenter)
    await runInstance(deps, r.instanceId!)
    const task = await deps.store.collection('human_tasks').findOne({ instanceId: r.instanceId!, status: 'PENDING' })
    expect(task).not.toBeNull()
    await decideTask(deps, task!.taskId, { decision: 'REJECTED', comment: 'Non autorizzato' }, presenter)
    await runInstance(deps, r.instanceId!)
    const { inst, ticket: t } = await load(deps, r.instanceId!)
    expect(inst.status).not.toBe('COMPLETED')
    expect(t.status).not.toBe('CLOSED')
  })

  it('Scenario D: injected failure escalates, manual retry recovers without duplicate artifacts or notifications', async () => {
    const deps = await freshDeps()
    await deps.store.collection('app_settings').updateOne({ key: 'app' }, { injectFailureNext: true })
    const r = await publishTicketEvent(deps, ticket('NA023', 'Il report dei sinistri non viene generato correttamente.', 'HIGH'), presenter)
    // Drive the instance until it stops advancing; with backoff the instance may need multiple ticks.
    for (let i = 0; i < 10; i++) {
      const inst = (await load(deps, r.instanceId!)).inst
      if (!['PENDING', 'RUNNING', 'RETRYING'].includes(inst.status)) break
      await deps.store.collection('workflow_instances').updateOne({ instanceId: r.instanceId! }, { nextRunAt: null })
      await runInstance(deps, r.instanceId!)
    }
    let state = await load(deps, r.instanceId!)
    expect(['FAILED', 'WAITING_FOR_HUMAN']).toContain(state.inst.status)
    expect(state.inst.status).not.toBe('COMPLETED')

    if (state.inst.status === 'FAILED') {
      await retryInstance(deps, r.instanceId!, presenter)
      await runInstance(deps, r.instanceId!)
      state = await load(deps, r.instanceId!)
    }
    for (let i = 0; i < 3 && state.inst.status === 'WAITING_FOR_HUMAN'; i++) {
      const task = await deps.store.collection('human_tasks').findOne({ instanceId: r.instanceId!, status: 'PENDING' })
      if (!task) break
      await decideTask(deps, task.taskId, { decision: 'APPROVED', comment: 'ok' }, presenter)
      await runInstance(deps, r.instanceId!)
      state = await load(deps, r.instanceId!)
    }
    expect(state.inst.status).toBe('COMPLETED')
    expect(state.ticket.status).toBe('CLOSED')
    expect(await deps.store.collection('artifacts').count({ instanceId: r.instanceId! })).toBeLessThanOrEqual(1)
    const emails = (await deps.store.collection('notifications').find({ instanceId: r.instanceId! })).filter((n) => n.channel === 'EMAIL')
    expect(emails).toHaveLength(1)
  })
})
