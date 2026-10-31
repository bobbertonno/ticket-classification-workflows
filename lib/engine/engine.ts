import { classifyRequest } from '@/lib/classification/classifier'
import type { Retriever } from '@/lib/classification/retriever'
import { artifactContent, findPolicy, sha256Hex, syntheticClaims, syntheticPayments } from '@/lib/documents/data'
import { newTicketId, randomId } from '@/lib/domain/ids'
import {
  RemedyTicketPayloadSchema,
  type AppSettings,
  type Artifact,
  type Category,
  type HumanTask,
  type KafkaMessage,
  type PublishEventInput,
  type RemedyTicket,
  type StepState,
  type WorkflowDefinition,
  type WorkflowInstance,
} from '@/lib/domain/schemas'
import { CATEGORY_WORKFLOW, CATEGORY_LABELS } from '@/lib/domain/seed-data'
import type { DataStore } from '@/lib/store/types'
import {
  SPEED_FACTOR,
  STEP_DELAY_MS,
  SYSTEM_ACTOR,
  audit,
  getSettings,
  publishInternal,
  saveInstance,
  updateTicket,
  workflowEvent,
  type Actor,
} from './support'

export interface EngineDeps {
  store: DataStore
  retriever: Retriever
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = 'ENGINE_ERROR',
  ) {
    super(message)
  }
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])

function freshStep(def: WorkflowDefinition['steps'][number]): StepState {
  return {
    stepId: def.id,
    type: def.type,
    label: def.label,
    status: 'PENDING',
    attempts: 0,
    startedAt: null,
    completedAt: null,
    input: null,
    output: null,
    error: null,
  }
}

function nowPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

async function getDefinition(store: DataStore, workflowId: string): Promise<WorkflowDefinition> {
  const def = await store.collection('workflow_definitions').findOne({ workflowId })
  if (!def) throw new EngineError(`Workflow ${workflowId} non trovato`, 500, 'WORKFLOW_NOT_FOUND')
  return def
}

/* ------------------------------------------------------------------ */
/* Publishing & consumption                                            */
/* ------------------------------------------------------------------ */

export interface PublishResult {
  duplicate: boolean
  message: KafkaMessage
  instanceId: string | null
}

export async function publishTicketEvent(deps: EngineDeps, input: PublishEventInput, actor: Actor): Promise<PublishResult> {
  const { store } = deps
  const agency = await store.collection('agencies').findOne({ agencyId: input.agencyId })
  if (!agency) throw new EngineError(`Agenzia ${input.agencyId} non trovata nell’anagrafica`, 404, 'AGENCY_NOT_FOUND')

  const eventId = input.eventId ?? randomId('EVT')
  const existing = await store.collection('kafka_messages').findOne({ eventId })
  if (existing) {
    await audit(store, {
      actor: actor.name,
      actorType: 'USER',
      agencyId: existing.agencyId,
      instanceId: existing.workflowInstanceId,
      ticketId: existing.ticketId,
      action: 'KAFKA_DUPLICATE_IGNORED',
      eventType: 'KAFKA',
      previousState: null,
      newState: null,
      correlationId: existing.correlationId,
      outcome: 'INFO',
      details: `eventId ${eventId} già pubblicato: nessun nuovo workflow creato (idempotenza)`,
    })
    return { duplicate: true, message: existing, instanceId: existing.workflowInstanceId }
  }

  const ticketId = input.ticketId ?? newTicketId()
  const correlationId = randomId('COR')
  const payload: Record<string, unknown> = {
    subject: input.subject,
    description: input.description,
    priority: input.priority,
    requestedBy: input.operatorName,
    ...(input.payload ?? {}),
  }
  const metadata: Record<string, unknown> = {
    source: 'kafka-simulator',
    publishedBy: actor.name,
    scenarioId: input.scenarioId ?? null,
    ...(input.metadata ?? {}),
  }
  const payloadCheck = RemedyTicketPayloadSchema.safeParse(payload)

  const offset = await store.collection('kafka_messages').count({ topic: 'remedy.ticket.created' })
  const message: KafkaMessage = {
    eventId,
    eventType: 'RemedyTicketCreated',
    topic: 'remedy.ticket.created',
    timestamp: new Date().toISOString(),
    correlationId,
    ticketId,
    workflowInstanceId: null,
    agencyId: agency.agencyId,
    agencyName: agency.agencyName,
    payload,
    metadata,
    schemaVersion: '1.2',
    consumerStatus: payloadCheck.success ? 'PENDING' : 'DEAD_LETTER',
    consumerError: payloadCheck.success ? null : payloadCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    replayOf: null,
    partition: 0,
    offset,
  }
  const inserted = await store.collection('kafka_messages').insertOne(message)
  if (!inserted) {
    const again = await store.collection('kafka_messages').findOne({ eventId })
    return { duplicate: true, message: again ?? message, instanceId: again?.workflowInstanceId ?? null }
  }
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: agency.agencyId,
    instanceId: null,
    ticketId,
    action: 'KAFKA_EVENT_PUBLISHED',
    eventType: 'KAFKA',
    previousState: null,
    newState: message.consumerStatus,
    correlationId,
    outcome: payloadCheck.success ? 'SUCCESS' : 'FAILURE',
    details: `Topic remedy.ticket.created · eventId ${eventId}`,
  })

  if (!payloadCheck.success) {
    await publishInternal(store, {
      eventId: `${eventId}-DLQ`,
      eventType: 'SchemaValidationFailed',
      topic: 'automation.dead-letter',
      correlationId,
      ticketId,
      workflowInstanceId: null,
      agencyId: agency.agencyId,
      agencyName: agency.agencyName,
      payload: { originalEventId: eventId, error: message.consumerError },
      metadata: { reason: 'SCHEMA_VALIDATION' },
      consumerStatus: 'DEAD_LETTER',
    })
    return { duplicate: false, message, instanceId: null }
  }

  const instanceId = await consumeTicketMessage(deps, message)
  const consumed = (await store.collection('kafka_messages').findOne({ eventId })) ?? message
  return { duplicate: false, message: consumed, instanceId }
}

/** Kafka consumer: materializes the Remedy ticket and the workflow instance (idempotent per eventId and ticketId). */
export async function consumeTicketMessage(deps: EngineDeps, msg: KafkaMessage): Promise<string | null> {
  const { store } = deps
  if (msg.consumerStatus !== 'PENDING') return msg.workflowInstanceId
  const settings = await getSettings(store)
  const agency = await store.collection('agencies').findOne({ agencyId: msg.agencyId })
  if (!agency) return null

  const existingTicket = await store.collection('remedy_tickets').findOne({ ticketId: msg.ticketId })
  if (existingTicket?.instanceId) {
    await store.collection('kafka_messages').updateOne(
      { eventId: msg.eventId },
      { consumerStatus: 'SKIPPED_DUPLICATE', consumerError: `Ticket ${msg.ticketId} già in lavorazione`, workflowInstanceId: existingTicket.instanceId },
    )
    return existingTicket.instanceId
  }

  const now = new Date().toISOString()
  const instanceId = `WFI-${msg.eventId.replace(/^EVT-/, '').toUpperCase()}`
  const p = msg.payload as { subject: string; description: string; priority: RemedyTicket['priority'] }

  const ticket: RemedyTicket = {
    ticketId: msg.ticketId,
    agencyId: agency.agencyId,
    agencyName: agency.agencyName,
    operatorId: agency.operatorId,
    operatorName: String(msg.payload.requestedBy ?? agency.operatorName),
    subject: p.subject,
    description: p.description,
    category: null,
    priority: p.priority,
    status: 'NEW',
    createdAt: now,
    updatedAt: now,
    workflowId: null,
    instanceId,
    correlationId: msg.correlationId,
    resolution: null,
    artifactIds: [],
    notificationStatus: 'NONE',
    timeline: [{ at: now, status: 'NEW', note: `Ticket creato da evento Kafka ${msg.eventId}` }],
    seeded: false,
  }
  if (!existingTicket) await store.collection('remedy_tickets').insertOne(ticket)
  else await store.collection('remedy_tickets').updateOne({ ticketId: msg.ticketId }, { instanceId })

  const intake = await getDefinition(store, 'wf-manual-triage')
  const injectFailure = msg.metadata.injectFailure === true || settings.injectFailureNext
  const instance: WorkflowInstance = {
    instanceId,
    workflowId: 'pending-classification',
    workflowName: 'In attesa di classificazione',
    ticketId: msg.ticketId,
    agencyId: agency.agencyId,
    agencyName: agency.agencyName,
    correlationId: msg.correlationId,
    status: 'RUNNING',
    executionMode: 'AUTOMATED',
    currentStepIndex: 1,
    steps: intake.steps.slice(0, 2).map((d, i) =>
      i === 0
        ? { ...freshStep(d), status: 'COMPLETED', attempts: 1, startedAt: now, completedAt: now, input: { topic: msg.topic }, output: { eventId: msg.eventId, partition: msg.partition, offset: msg.offset } }
        : freshStep(d),
    ),
    context: { subject: p.subject, description: p.description, priority: p.priority, sourceEventId: msg.eventId, artifactIds: [], notificationDelivered: false },
    slaMinutes: 240,
    retryPolicy: { maxAttempts: 3, backoffMs: 1500 },
    failureInjection: injectFailure ? { remaining: 99 } : null,
    revision: 1,
    nextRunAt: nowPlus(STEP_DELAY_MS[settings.simulationSpeed]),
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    seeded: false,
  }
  const created = await store.collection('workflow_instances').insertOne(instance)
  if (!created) return instanceId
  if (settings.injectFailureNext) await store.collection('app_settings').updateOne({ key: 'app' }, { injectFailureNext: false })

  await store.collection('kafka_messages').updateOne({ eventId: msg.eventId }, { consumerStatus: 'CONSUMED', workflowInstanceId: instanceId })
  await workflowEvent(store, instance, 'INSTANCE_CREATED', `Istanza creata dal consumer Kafka (evento ${msg.eventId})`, 'trigger')
  await audit(store, {
    actor: SYSTEM_ACTOR.name,
    actorType: 'SYSTEM',
    agencyId: agency.agencyId,
    instanceId,
    ticketId: msg.ticketId,
    action: 'WORKFLOW_INSTANCE_CREATED',
    eventType: 'WORKFLOW',
    previousState: null,
    newState: 'RUNNING',
    correlationId: msg.correlationId,
    outcome: 'SUCCESS',
    details: injectFailure ? 'Iniezione guasto attiva per questa istanza' : null,
  })

  if (settings.simulationSpeed === 'instant' && !settings.paused) await runInstance(deps, instanceId)
  return instanceId
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

type StepOutcome =
  | { kind: 'completed'; output: Record<string, unknown>; context?: Record<string, unknown>; skipped?: boolean; rebind?: WorkflowDefinition }
  | { kind: 'waiting'; output: Record<string, unknown> }
  | { kind: 'failed'; error: string; retryable: boolean; consumeInjection?: boolean }

export interface TickResult {
  paused: boolean
  processed: number
  instances: string[]
}

/** Execution tick: advances due instances by one step (or to a wait point in instant mode). Safe to call concurrently. */
export async function tick(deps: EngineDeps, opts: { instanceId?: string; limit?: number } = {}): Promise<TickResult> {
  const { store } = deps
  const settings = await getSettings(store)
  if (settings.paused) return { paused: true, processed: 0, instances: [] }

  // Outbox recovery: consume any ticket events left PENDING by an interrupted request.
  const stale = await store.collection('kafka_messages').find({ topic: 'remedy.ticket.created', consumerStatus: 'PENDING' }, { limit: 10 })
  for (const m of stale) if (Date.now() - new Date(m.timestamp).getTime() > 3000) await consumeTicketMessage(deps, m)

  const filter = opts.instanceId
    ? { instanceId: opts.instanceId }
    : { status: { $in: ['PENDING', 'RUNNING', 'RETRYING'] as WorkflowInstance['status'][] } }
  const candidates = await store.collection('workflow_instances').find(filter, { sort: { field: 'updatedAt', dir: 1 }, limit: opts.limit ?? 25 })
  const now = Date.now()
  const processed: string[] = []
  for (const inst of candidates) {
    if (!['PENDING', 'RUNNING', 'RETRYING'].includes(inst.status)) continue
    if (inst.nextRunAt && new Date(inst.nextRunAt).getTime() > now) continue
    const advanced = settings.simulationSpeed === 'instant' ? await runInstance(deps, inst.instanceId) : await executeStep(deps, inst.instanceId, settings)
    if (advanced) processed.push(inst.instanceId)
  }
  return { paused: false, processed: processed.length, instances: processed }
}

export async function runInstance(deps: EngineDeps, instanceId: string, maxSteps = 40): Promise<boolean> {
  const settings = await getSettings(deps.store)
  let any = false
  for (let i = 0; i < maxSteps; i++) {
    const inst = await deps.store.collection('workflow_instances').findOne({ instanceId })
    if (!inst || !['PENDING', 'RUNNING', 'RETRYING'].includes(inst.status)) break
    const ok = await executeStep(deps, instanceId, settings)
    if (!ok) break
    any = true
  }
  return any
}

export async function executeStep(deps: EngineDeps, instanceId: string, settings: AppSettings): Promise<boolean> {
  const { store } = deps
  const inst = await store.collection('workflow_instances').findOne({ instanceId })
  if (!inst || !['PENDING', 'RUNNING', 'RETRYING'].includes(inst.status)) return false
  const step = inst.steps[inst.currentStepIndex]
  if (!step) return false

  // Claim the step atomically (prevents two concurrent ticks from executing it twice).
  const claimedAt = new Date().toISOString()
  const claimedSteps = inst.steps.map((s, i) =>
    i === inst.currentStepIndex ? { ...s, status: 'RUNNING' as const, attempts: s.attempts + 1, startedAt: s.startedAt ?? claimedAt, error: null } : s,
  )
  const claimed = await saveInstance(store, inst, { ...inst, status: 'RUNNING', steps: claimedSteps })
  if (!claimed) return false
  const current = claimed.steps[claimed.currentStepIndex]
  if (current.attempts === 1) await workflowEvent(store, claimed, 'STEP_STARTED', `Avvio step: ${current.label}`, current.stepId)
  else await workflowEvent(store, claimed, 'STEP_RETRY', `Tentativo ${current.attempts} di ${claimed.retryPolicy.maxAttempts}: ${current.label}`, current.stepId)

  const definition = claimed.workflowId === 'pending-classification' ? null : await getDefinition(store, claimed.workflowId)
  const stepDef = definition?.steps.find((s) => s.id === current.stepId)

  let outcome: StepOutcome
  try {
    outcome = await runHandler(deps, claimed, current, stepDef?.handler ?? 'semantic_classification', definition, settings)
  } catch (err) {
    outcome = { kind: 'failed', error: `Errore inatteso: ${(err as Error).message}`, retryable: true }
  }
  await applyOutcome(deps, claimed, outcome, settings)
  return true
}

async function applyOutcome(deps: EngineDeps, inst: WorkflowInstance, outcome: StepOutcome, settings: AppSettings): Promise<void> {
  const { store } = deps
  const idx = inst.currentStepIndex
  const step = inst.steps[idx]
  const ts = new Date().toISOString()
  const delay = STEP_DELAY_MS[settings.simulationSpeed]

  if (outcome.kind === 'completed') {
    let steps = inst.steps.map((s, i) =>
      i === idx ? { ...s, status: outcome.skipped ? ('SKIPPED' as const) : ('COMPLETED' as const), completedAt: ts, output: outcome.output } : s,
    )
    let next: WorkflowInstance = { ...inst, steps, context: { ...inst.context, ...(outcome.context ?? {}) } }
    if (outcome.rebind) {
      const def = outcome.rebind
      steps = def.steps.map((d, i) => (i < steps.length && steps[i].stepId === d.id ? steps[i] : freshStep(d)))
      next = { ...next, steps, workflowId: def.workflowId, workflowName: def.name, executionMode: def.executionMode, slaMinutes: def.slaMinutes, retryPolicy: def.retryPolicy }
      if (next.failureInjection?.remaining === 99) next.failureInjection = { remaining: def.retryPolicy.maxAttempts }
    }
    const nextIdx = findNextRunnable(next.steps, idx + 1)
    if (step.type === 'completion' || nextIdx === -1) {
      next = {
        ...next,
        steps: next.steps.map((s) => (s.type === 'error_handler' && s.status === 'PENDING' ? { ...s, status: 'SKIPPED' } : s)),
        status: 'COMPLETED',
        completedAt: ts,
        nextRunAt: null,
      }
    } else {
      next = { ...next, currentStepIndex: nextIdx, status: 'RUNNING', nextRunAt: nowPlus(delay) }
    }
    const saved = await saveInstance(store, inst, next)
    if (!saved) return
    await workflowEvent(store, saved, outcome.skipped ? 'STEP_SKIPPED' : 'STEP_COMPLETED', `${outcome.skipped ? 'Step saltato' : 'Step completato'}: ${step.label}`, step.stepId, outcome.output)
    if (saved.status === 'COMPLETED') {
      await workflowEvent(store, saved, 'INSTANCE_COMPLETED', 'Workflow completato con successo')
      await audit(store, {
        actor: SYSTEM_ACTOR.name,
        actorType: 'SYSTEM',
        agencyId: saved.agencyId,
        instanceId: saved.instanceId,
        ticketId: saved.ticketId,
        action: 'WORKFLOW_COMPLETED',
        eventType: 'WORKFLOW',
        previousState: inst.status,
        newState: 'COMPLETED',
        correlationId: saved.correlationId,
        outcome: 'SUCCESS',
        details: saved.workflowName,
      })
    }
    return
  }

  if (outcome.kind === 'waiting') {
    const steps = inst.steps.map((s, i) => (i === idx ? { ...s, status: 'WAITING' as const, output: outcome.output } : s))
    const saved = await saveInstance(store, inst, { ...inst, steps, status: 'WAITING_FOR_HUMAN', nextRunAt: null })
    if (saved) await workflowEvent(store, saved, 'WAITING_FOR_HUMAN', `Esecuzione in pausa: ${step.label}`, step.stepId, outcome.output)
    return
  }

  // failed
  const failureInjection =
    outcome.consumeInjection && inst.failureInjection ? { remaining: Math.max(0, inst.failureInjection.remaining - 1) } : inst.failureInjection
  const canRetry = outcome.retryable && step.attempts < inst.retryPolicy.maxAttempts
  if (canRetry) {
    const backoff = inst.retryPolicy.backoffMs * 2 ** (step.attempts - 1) * SPEED_FACTOR[settings.simulationSpeed]
    const steps = inst.steps.map((s, i) => (i === idx ? { ...s, status: 'FAILED' as const, error: outcome.error } : s))
    const saved = await saveInstance(store, inst, { ...inst, steps, status: 'RETRYING', failureInjection, nextRunAt: nowPlus(backoff) })
    if (!saved) return
    await workflowEvent(store, saved, 'STEP_FAILED', `${step.label}: ${outcome.error}`, step.stepId, { attempt: step.attempts, retryInMs: Math.round(backoff) })
    await audit(store, {
      actor: SYSTEM_ACTOR.name,
      actorType: 'SYSTEM',
      agencyId: saved.agencyId,
      instanceId: saved.instanceId,
      ticketId: saved.ticketId,
      action: 'STEP_FAILED_RETRY_SCHEDULED',
      eventType: 'WORKFLOW',
      previousState: 'RUNNING',
      newState: 'RETRYING',
      correlationId: saved.correlationId,
      outcome: 'FAILURE',
      details: `${outcome.error} (tentativo ${step.attempts}/${inst.retryPolicy.maxAttempts})`,
    })
    return
  }

  const errIdx = inst.steps.findIndex((s) => s.type === 'error_handler')
  const steps = inst.steps.map((s, i) => {
    if (i === idx) return { ...s, status: 'FAILED' as const, error: outcome.error, completedAt: ts }
    if (i === errIdx) return { ...s, status: 'COMPLETED' as const, attempts: s.attempts + 1, startedAt: ts, completedAt: ts, output: { escalated: true, failedStep: step.stepId, reason: outcome.error } }
    return s
  })
  const saved = await saveInstance(store, inst, { ...inst, steps, status: 'FAILED', failureInjection, nextRunAt: null })
  if (!saved) return
  await workflowEvent(store, saved, 'INSTANCE_FAILED', `Workflow fallito su "${step.label}": ${outcome.error}`, step.stepId)
  await escalate(deps, saved, step, outcome.error)
}

function findNextRunnable(steps: StepState[], from: number): number {
  for (let i = from; i < steps.length; i++) if (steps[i].type !== 'error_handler') return i
  return -1
}

async function escalate(deps: EngineDeps, inst: WorkflowInstance, step: StepState, error: string): Promise<void> {
  const { store } = deps
  const attempt = `${inst.revision}-${step.attempts}-${inst.version}`
  await updateTicket(store, inst.ticketId, { status: 'ESCALATED' }, `Escalation: ${step.label} fallito — ${error}`)
  await publishInternal(store, {
    eventId: `EVT-FAIL-${inst.instanceId}-${attempt}`,
    eventType: 'ExecutionFailed',
    topic: 'automation.execution.failed',
    correlationId: inst.correlationId,
    ticketId: inst.ticketId,
    workflowInstanceId: inst.instanceId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    payload: { stepId: step.stepId, error, attempts: step.attempts },
    metadata: { workflowId: inst.workflowId },
  })
  await publishInternal(store, {
    eventId: `EVT-DLQ-${inst.instanceId}-${attempt}`,
    eventType: 'ExecutionDeadLettered',
    topic: 'automation.dead-letter',
    correlationId: inst.correlationId,
    ticketId: inst.ticketId,
    workflowInstanceId: inst.instanceId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    payload: { stepId: step.stepId, error, retriesExhausted: true },
    metadata: { workflowId: inst.workflowId, action: 'MANUAL_RETRY_REQUIRED' },
    consumerStatus: 'DEAD_LETTER',
  })
  await store.collection('notifications').insertOne({
    notificationId: `NTF-${inst.instanceId}-alert-${attempt}`,
    ticketId: inst.ticketId,
    instanceId: inst.instanceId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    recipient: 'automation-ops@demo.invalid',
    channel: 'WORKFLOW_ALERT',
    subject: `[ESCALATION] ${inst.workflowName} — ${inst.ticketId}`,
    message: `Lo step "${step.label}" è fallito dopo ${step.attempts} tentativi: ${error}. È richiesto un retry manuale.`,
    artifactIds: [],
    deliveryStatus: 'DELIVERED',
    simulated: true,
    timestamp: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
  })
  await audit(store, {
    actor: SYSTEM_ACTOR.name,
    actorType: 'SYSTEM',
    agencyId: inst.agencyId,
    instanceId: inst.instanceId,
    ticketId: inst.ticketId,
    action: 'WORKFLOW_FAILED_ESCALATED',
    eventType: 'WORKFLOW',
    previousState: 'RUNNING',
    newState: 'FAILED',
    correlationId: inst.correlationId,
    outcome: 'FAILURE',
    details: error,
  })
}

/* ------------------------------------------------------------------ */
/* Step handlers                                                       */
/* ------------------------------------------------------------------ */

function ctxParams(inst: WorkflowInstance): Record<string, string | number | boolean> {
  return (inst.context.params as Record<string, string | number | boolean>) ?? {}
}

async function runHandler(
  deps: EngineDeps,
  inst: WorkflowInstance,
  step: StepState,
  handler: string,
  definition: WorkflowDefinition | null,
  settings: AppSettings,
): Promise<StepOutcome> {
  const { store } = deps
  const params = ctxParams(inst)

  switch (handler) {
    case 'semantic_classification':
      return classifyStep(deps, inst, settings)

    case 'require_period': {
      if (params.periodMonth) return { kind: 'completed', output: { branch: 'periodo specificato', period: params.periodLabel } }
      const d = new Date()
      d.setMonth(d.getMonth() - 1)
      const label = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
      return {
        kind: 'completed',
        output: { branch: 'default applicato', period: label },
        context: { params: { ...params, periodMonth: d.getMonth() + 1, periodYear: d.getFullYear(), periodLabel: label } },
      }
    }

    case 'fetch_claims': {
      const { year, month } = period(params)
      const rows = syntheticClaims(inst.agencyId, year, month)
      const total = rows.reduce((a, r) => a + r.amount, 0)
      return {
        kind: 'completed',
        output: { endpoint: 'GET claims-api/v2/claims (simulato)', agencyId: inst.agencyId, period: `${month}/${year}`, recordCount: rows.length, totalAmount: Math.round(total * 100) / 100 },
        context: { recordCount: rows.length },
      }
    }

    case 'fetch_payments': {
      const { year, month } = period(params)
      const rows = syntheticPayments(inst.agencyId, year, month)
      return { kind: 'completed', output: { endpoint: 'GET billing-api/v1/payments (simulato)', recordCount: rows.length } }
    }

    case 'authorize_policy_access': {
      const policyId = params.policyId ? String(params.policyId) : null
      if (!policyId) return { kind: 'failed', error: 'Numero di polizza non estratto dalla richiesta', retryable: false }
      const policy = findPolicy(policyId)
      if (!policy) return { kind: 'failed', error: `Polizza ${policyId} inesistente nel sistema sintetico`, retryable: false }
      if (policy.agencyId !== inst.agencyId)
        return { kind: 'failed', error: `Agenzia ${inst.agencyId} non autorizzata sulla polizza ${policyId}`, retryable: false }
      return { kind: 'completed', output: { authorized: true, policyId, ownerAgency: policy.agencyId, rule: 'policy.agencyId == ticket.agencyId' } }
    }

    case 'fetch_policy': {
      const policy = findPolicy(String(params.policyId))
      return { kind: 'completed', output: { endpoint: 'GET policy-api/v1/policies (simulato)', ...(policy ?? {}) } }
    }

    case 'extract_access':
      return {
        kind: 'completed',
        output: { requestedAccess: params.requestedAccess ?? 'Portale agenzie', accessLevel: params.accessLevel ?? 'OPERATOR', beneficiary: params.beneficiary ?? 'N/D' },
      }

    case 'provision_access':
      return {
        kind: 'completed',
        output: { endpoint: 'POST iam-api/v3/grants (simulato)', grantId: `GRANT-${inst.instanceId}`, system: params.requestedAccess ?? 'Portale agenzie', status: 'ATTIVO (simulato)' },
      }

    case 'diagnose_report':
      return {
        kind: 'completed',
        output: { service: 'reporting-api', finding: inst.failureInjection?.remaining ? 'Latenza anomala rilevata sul servizio di reportistica' : 'Servizio operativo', status: inst.failureInjection?.remaining ? 'DEGRADED' : 'OK' },
      }

    case 'lookup_claim_status':
      return { kind: 'completed', output: { endpoint: 'GET claims-api/v2/claims/{id}/status (simulato)', claimStatus: 'IN PERIZIA', lastUpdate: new Date().toISOString().slice(0, 10) } }

    case 'validate_customer_data':
      return { kind: 'completed', output: { valid: true, checks: ['Formato IBAN', 'Codice fiscale', 'Indirizzo normalizzato'] } }

    case 'apply_customer_update':
      return { kind: 'completed', output: { endpoint: 'PATCH crm-api/v1/customers (simulato)', updated: true } }

    case 'claims_xlsx':
    case 'payments_xlsx':
    case 'policy_pdf':
    case 'certificate_pdf':
      return generateDocument(deps, inst, step, handler)

    case 'report_approval':
    case 'access_approval':
    case 'document_approval':
    case 'manual_triage':
      return approvalStep(deps, inst, step, handler, definition, settings)

    case 'deliver_notification':
      return notificationStep(deps, inst)

    case 'close_ticket': {
      const needsArtifact = inst.steps.some((s) => s.type === 'document_generation')
      const artifactIds = (inst.context.artifactIds as string[]) ?? []
      if (!inst.context.notificationDelivered)
        return { kind: 'failed', error: 'Guardia di chiusura: notifica non consegnata', retryable: false }
      if (needsArtifact && artifactIds.length === 0)
        return { kind: 'failed', error: 'Guardia di chiusura: nessun artefatto validato', retryable: false }
      const resolution = buildResolution(inst)
      await updateTicket(store, inst.ticketId, { status: 'CLOSED', resolution }, 'Ticket chiuso automaticamente dopo validazione output e consegna notifica')
      await publishInternal(store, {
        eventId: `EVT-DONE-${inst.instanceId}-r${inst.revision}`,
        eventType: 'AutomationTaskCompleted',
        topic: 'automation.task.completed',
        correlationId: inst.correlationId,
        ticketId: inst.ticketId,
        workflowInstanceId: inst.instanceId,
        agencyId: inst.agencyId,
        agencyName: inst.agencyName,
        payload: { workflowId: inst.workflowId, resolution, artifactIds },
        metadata: {},
      })
      return { kind: 'completed', output: { ticketStatus: 'CLOSED', resolution } }
    }

    case 'complete':
      return { kind: 'completed', output: { completed: true } }

    default:
      return { kind: 'failed', error: `Handler sconosciuto: ${handler}`, retryable: false }
  }
}

function period(params: Record<string, string | number | boolean>): { year: number; month: number } {
  const d = new Date()
  return { year: Number(params.periodYear ?? d.getFullYear()), month: Number(params.periodMonth ?? d.getMonth() + 1) }
}

function buildResolution(inst: WorkflowInstance): string {
  const n = ((inst.context.artifactIds as string[]) ?? []).length
  const cat = inst.context.category as Category | undefined
  return `Richiesta "${cat ? CATEGORY_LABELS[cat] : inst.workflowName}" evasa tramite ${inst.workflowName}${n ? ` · ${n} documento/i allegato/i` : ''}. Notifica consegnata all’agenzia ${inst.agencyId}.`
}

async function classifyStep(deps: EngineDeps, inst: WorkflowInstance, settings: AppSettings): Promise<StepOutcome> {
  const { store } = deps
  await updateTicket(store, inst.ticketId, { status: 'CLASSIFYING' }, 'Classificazione semantica in corso')

  const classificationId = `CLS-${inst.instanceId}`
  let result = await store.collection('classification_results').findOne({ classificationId })
  if (!result) {
    const computed = await classifyRequest(
      store,
      deps.retriever,
      { ticketId: inst.ticketId, instanceId: inst.instanceId, agencyId: inst.agencyId, subject: String(inst.context.subject), description: String(inst.context.description) },
      settings,
    )
    result = { ...computed, classificationId }
    if (!settings.autoClassification) {
      result = {
        ...result,
        humanReviewRequired: true,
        decisionRule: `Classificazione automatica disabilitata nelle impostazioni → triage manuale (suggerito: ${result.selectedCategory})`,
      }
    }
    await store.collection('classification_results').insertOne(result)
    await audit(store, {
      actor: SYSTEM_ACTOR.name,
      actorType: 'SYSTEM',
      agencyId: inst.agencyId,
      instanceId: inst.instanceId,
      ticketId: inst.ticketId,
      action: 'TICKET_CLASSIFIED',
      eventType: 'CLASSIFICATION',
      previousState: null,
      newState: result.humanReviewRequired ? 'MANUAL_TRIAGE' : result.selectedCategory,
      correlationId: inst.correlationId,
      outcome: result.fallbackReason ? 'INFO' : 'SUCCESS',
      details: `${result.method}${result.simulated ? ' (SIMULATO)' : ''} · ${result.decisionRule}`,
    })
  }

  const workflowId = result.humanReviewRequired ? 'wf-manual-triage' : CATEGORY_WORKFLOW[result.selectedCategory]
  const def = await getDefinition(store, workflowId)
  await updateTicket(
    store,
    inst.ticketId,
    { status: 'CLASSIFIED', category: result.humanReviewRequired ? null : result.selectedCategory, workflowId },
    result.humanReviewRequired ? 'Classificazione incerta: instradato a triage manuale' : `Classificato come ${result.selectedCategory} → ${def.name}`,
  )
  await publishInternal(store, {
    eventId: `EVT-REQ-${inst.instanceId}`,
    eventType: 'AutomationExecutionRequested',
    topic: 'automation.execution.requested',
    correlationId: inst.correlationId,
    ticketId: inst.ticketId,
    workflowInstanceId: inst.instanceId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    payload: { workflowId, category: result.selectedCategory, classificationId },
    metadata: { method: result.method, simulated: result.simulated },
  })

  const top = result.semanticMatches[0]
  return {
    kind: 'completed',
    output: {
      classificationId,
      method: result.method,
      simulated: result.simulated,
      model: result.modelName,
      selectedCategory: result.selectedCategory,
      topMatchScore: top?.score ?? null,
      workflowId,
      rule: result.decisionRule,
    },
    context: {
      category: result.humanReviewRequired ? null : result.selectedCategory,
      suggestedCategory: result.selectedCategory,
      params: result.extractedParameters,
      approvalRequired: result.policyDecision.approvalRequired,
      classificationId,
    },
    rebind: def,
  }
}

async function generateDocument(deps: EngineDeps, inst: WorkflowInstance, step: StepState, handler: string): Promise<StepOutcome> {
  const { store } = deps
  if (step.attempts === 1) await updateTicket(store, inst.ticketId, { status: 'IN_PROGRESS' }, `Esecuzione: ${step.label}`)
  if (inst.failureInjection && inst.failureInjection.remaining > 0) {
    return { kind: 'failed', error: 'Simulated failure: reporting-api timeout (HTTP 504)', retryable: true, consumeInjection: true }
  }
  const params = ctxParams(inst)
  const { year, month } = period(params)
  const kind: Artifact['kind'] =
    handler === 'claims_xlsx' ? 'CLAIMS_XLSX' : handler === 'payments_xlsx' ? 'PAYMENTS_XLSX' : handler === 'policy_pdf' ? 'POLICY_PDF' : 'CERT_PDF'
  const isXlsx = kind.endsWith('XLSX')
  const artifactParams: Record<string, string | number> = {
    agencyId: inst.agencyId,
    year,
    month,
    periodLabel: String(params.periodLabel ?? `${month}/${year}`),
    subject: String(inst.context.subject ?? ''),
  }
  if (params.policyId) artifactParams.policyId = String(params.policyId)
  const content = artifactContent(kind, artifactParams)
  if (content.rowCount === 0) return { kind: 'failed', error: 'Validazione output: documento vuoto', retryable: true }

  const artifactId = `ART-${inst.instanceId}-${step.stepId}-r${inst.revision}`
  const base =
    kind === 'CLAIMS_XLSX'
      ? `report_sinistri_${inst.agencyId}_${year}-${String(month).padStart(2, '0')}`
      : kind === 'PAYMENTS_XLSX'
        ? `report_pagamenti_${inst.agencyId}_${year}-${String(month).padStart(2, '0')}`
        : kind === 'POLICY_PDF'
          ? `polizza_${artifactParams.policyId ?? 'ND'}_copia`
          : `attestazione_${inst.ticketId}`
  const artifact: Artifact = {
    artifactId,
    instanceId: inst.instanceId,
    ticketId: inst.ticketId,
    agencyId: inst.agencyId,
    kind,
    fileName: `${base}_r${inst.revision}_DEMO.${isXlsx ? 'xlsx' : 'pdf'}`,
    mimeType: isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    params: artifactParams,
    rowCount: content.rowCount,
    contentHash: await sha256Hex(JSON.stringify(content.rows)),
    storage: 'DETERMINISTIC_REGENERATION',
    revision: inst.revision,
    createdAt: new Date().toISOString(),
  }
  const created = await store.collection('artifacts').insertOne(artifact)
  const existingIds = (inst.context.artifactIds as string[]) ?? []
  const artifactIds = existingIds.includes(artifactId) ? existingIds : [...existingIds, artifactId]
  if (created) {
    const t = await store.collection('remedy_tickets').findOne({ ticketId: inst.ticketId })
    if (t && !t.artifactIds.includes(artifactId)) await updateTicket(store, inst.ticketId, { artifactIds: [...t.artifactIds, artifactId] })
    await audit(store, {
      actor: SYSTEM_ACTOR.name,
      actorType: 'SYSTEM',
      agencyId: inst.agencyId,
      instanceId: inst.instanceId,
      ticketId: inst.ticketId,
      action: 'ARTIFACT_GENERATED',
      eventType: 'ARTIFACT',
      previousState: null,
      newState: artifact.fileName,
      correlationId: inst.correlationId,
      outcome: 'SUCCESS',
      details: `${content.rowCount} righe · sha256 ${artifact.contentHash.slice(0, 12)}…`,
    })
  }
  return {
    kind: 'completed',
    output: { artifactId, fileName: artifact.fileName, rowCount: content.rowCount, contentHash: artifact.contentHash, validated: true, reusedExisting: !created },
    context: { artifactIds, latestArtifactId: artifactId },
  }
}

async function approvalStep(
  deps: EngineDeps,
  inst: WorkflowInstance,
  step: StepState,
  handler: string,
  definition: WorkflowDefinition | null,
  settings: AppSettings,
): Promise<StepOutcome> {
  const { store } = deps
  const isTriage = handler === 'manual_triage'
  const category = inst.context.category as Category | null
  if (!isTriage && category && settings.approvalPolicies[category] === false) {
    return { kind: 'completed', skipped: true, output: { skipped: true, reason: `Policy di approvazione disattivata per ${category}` } }
  }
  const policy = definition?.approvalPolicy
  const taskId = `HT-${inst.instanceId.replace(/^WFI-/, '')}-${step.stepId}-r${inst.revision}`
  const ticket = await store.collection('remedy_tickets').findOne({ ticketId: inst.ticketId })
  const approvalType: HumanTask['approvalType'] =
    handler === 'report_approval' ? 'REPORT_APPROVAL' : handler === 'access_approval' ? 'ACCESS_APPROVAL' : isTriage ? 'MANUAL_TRIAGE' : 'DOCUMENT_APPROVAL'
  const task: HumanTask = {
    taskId,
    instanceId: inst.instanceId,
    stepId: step.stepId,
    ticketId: inst.ticketId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    operatorName: ticket?.operatorName ?? '',
    approvalType,
    title: isTriage ? `Triage manuale: ${ticket?.subject ?? inst.ticketId}` : `${step.label}: ${ticket?.subject ?? inst.ticketId}`,
    assignedTeam: policy?.assignedTeam ?? 'Service Desk',
    assignedRole: policy?.approverRole ?? 'approver',
    assignedTo: null,
    priority: ticket?.priority ?? 'MEDIUM',
    status: 'PENDING',
    dueAt: nowPlus((policy?.dueInMinutes ?? 60) * 60_000),
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decision: null,
    comments: [],
    artifactIds: ((inst.context.artifactIds as string[]) ?? []).filter((id) => id.endsWith(`-r${inst.revision}`)),
    suggestedCategory: (inst.context.suggestedCategory as Category | null) ?? null,
    version: 1,
  }
  const created = await store.collection('human_tasks').insertOne(task)
  if (created) {
    await updateTicket(store, inst.ticketId, { status: 'WAITING_FOR_APPROVAL' }, `In attesa di ${isTriage ? 'triage manuale' : 'approvazione'} (${task.assignedTeam})`)
    await audit(store, {
      actor: SYSTEM_ACTOR.name,
      actorType: 'SYSTEM',
      agencyId: inst.agencyId,
      instanceId: inst.instanceId,
      ticketId: inst.ticketId,
      action: 'HUMAN_TASK_CREATED',
      eventType: 'HUMAN_TASK',
      previousState: null,
      newState: 'PENDING',
      correlationId: inst.correlationId,
      outcome: 'INFO',
      details: `${taskId} assegnato a ${task.assignedTeam}`,
    })
  }
  return { kind: 'waiting', output: { taskId, assignedTeam: task.assignedTeam, dueAt: task.dueAt } }
}

async function notificationStep(deps: EngineDeps, inst: WorkflowInstance): Promise<StepOutcome> {
  const { store } = deps
  const ticket = await store.collection('remedy_tickets').findOne({ ticketId: inst.ticketId })
  const agency = await store.collection('agencies').findOne({ agencyId: inst.agencyId })
  const artifactIds = ((inst.context.artifactIds as string[]) ?? []).filter((id) => id.endsWith(`-r${inst.revision}`))
  const emailId = `NTF-${inst.instanceId}-email`
  const ts = new Date().toISOString()

  const email = {
    notificationId: emailId,
    ticketId: inst.ticketId,
    instanceId: inst.instanceId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    recipient: `${agency?.operatorName.toLowerCase().replace(/\s+/g, '.') ?? 'agenzia'}@${inst.agencyId.toLowerCase()}.agenzie.demo.invalid`,
    channel: 'EMAIL' as const,
    subject: `[${inst.ticketId}] Richiesta evasa — ${ticket?.subject ?? ''}`,
    message: `Gentile ${ticket?.operatorName ?? 'collega'}, la sua richiesta è stata evasa tramite il workflow "${inst.workflowName}".${artifactIds.length ? ' In allegato il documento generato (DATI SINTETICI).' : ''}`,
    artifactIds,
    deliveryStatus: 'QUEUED' as const,
    simulated: true as const,
    timestamp: ts,
    deliveredAt: null,
  }
  const firstTime = await store.collection('notifications').insertOne(email)
  if (firstTime) {
    await updateTicket(store, inst.ticketId, { notificationStatus: 'QUEUED' })
    await publishInternal(store, {
      eventId: `EVT-NTF-${inst.instanceId}`,
      eventType: 'NotificationOutbound',
      topic: 'automation.notification.outbound',
      correlationId: inst.correlationId,
      ticketId: inst.ticketId,
      workflowInstanceId: inst.instanceId,
      agencyId: inst.agencyId,
      agencyName: inst.agencyName,
      payload: { notificationId: emailId, channel: 'EMAIL', recipient: email.recipient, artifactIds },
      metadata: { simulated: true },
    })
  }
  // Simulated SMTP gateway acknowledges delivery.
  await store.collection('notifications').updateOne({ notificationId: emailId }, { deliveryStatus: 'DELIVERED', deliveredAt: new Date().toISOString() })
  await store.collection('notifications').insertOne({
    ...email,
    notificationId: `NTF-${inst.instanceId}-remedy`,
    recipient: `Remedy ${inst.ticketId}`,
    channel: 'REMEDY_COMMENT',
    subject: 'Work note automatica',
    message: `Workflow ${inst.workflowId} completato. Notifica email ${emailId} consegnata.`,
    deliveryStatus: 'DELIVERED',
    deliveredAt: new Date().toISOString(),
  })
  await updateTicket(store, inst.ticketId, { status: 'RESOLVED', notificationStatus: 'DELIVERED' }, `Notifica ${emailId} consegnata (simulata)`)
  if (firstTime)
    await audit(store, {
      actor: SYSTEM_ACTOR.name,
      actorType: 'SYSTEM',
      agencyId: inst.agencyId,
      instanceId: inst.instanceId,
      ticketId: inst.ticketId,
      action: 'NOTIFICATION_DELIVERED',
      eventType: 'NOTIFICATION',
      previousState: 'QUEUED',
      newState: 'DELIVERED',
      correlationId: inst.correlationId,
      outcome: 'SUCCESS',
      details: `${email.recipient} (simulato)`,
    })
  return { kind: 'completed', output: { notificationId: emailId, deliveryStatus: 'DELIVERED', simulated: true, duplicateSuppressed: !firstTime }, context: { notificationDelivered: true } }
}

/* ------------------------------------------------------------------ */
/* Human decisions & controlled actions                               */
/* ------------------------------------------------------------------ */

export interface DecisionInput {
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'
  comment: string
  overrideCategory?: Category
}

export function canDecide(actor: Actor, task: Pick<HumanTask, 'assignedRole'>): boolean {
  if (actor.role === 'admin') return true
  return actor.role === 'approver' && task.assignedRole === 'approver'
}

export async function decideTask(deps: EngineDeps, taskId: string, input: DecisionInput, actor: Actor): Promise<HumanTask> {
  const { store } = deps
  const task = await store.collection('human_tasks').findOne({ taskId })
  if (!task) throw new EngineError('Task non trovato', 404, 'NOT_FOUND')
  if (!canDecide(actor, task)) throw new EngineError(`Utente ${actor.name} (${actor.role}) non autorizzato: ruolo richiesto ${task.assignedRole}`, 403, 'FORBIDDEN')
  if (task.status !== 'PENDING') throw new EngineError(`Task già deciso (${task.status})`, 409, 'ALREADY_DECIDED')
  const inst = await store.collection('workflow_instances').findOne({ instanceId: task.instanceId })
  if (!inst || inst.status !== 'WAITING_FOR_HUMAN') throw new EngineError('L’istanza non è in attesa di decisione umana', 409, 'INVALID_STATE')
  const idx = inst.steps.findIndex((s) => s.stepId === task.stepId)
  if (idx !== inst.currentStepIndex) throw new EngineError('Lo step del task non è lo step corrente', 409, 'INVALID_STATE')

  const isTriage = task.approvalType === 'MANUAL_TRIAGE'
  let triageCategory: Category | null = null
  if (isTriage && input.decision === 'APPROVED') {
    triageCategory = input.overrideCategory ?? task.suggestedCategory
    if (!triageCategory || triageCategory === 'UNKNOWN')
      throw new EngineError('Per il triage è necessario selezionare una categoria valida', 400, 'CATEGORY_REQUIRED')
  }

  const ts = new Date().toISOString()
  const newInstanceState = input.decision === 'REJECTED' ? 'CANCELLED' : 'RUNNING'
  const decided: HumanTask = {
    ...task,
    status: input.decision,
    decidedAt: ts,
    assignedTo: actor.id,
    decision: {
      decision: input.decision,
      approver: actor.name,
      approverId: actor.id,
      timestamp: ts,
      comment: input.comment,
      previousState: inst.status,
      newState: newInstanceState,
      ...(triageCategory ? { overrideCategory: triageCategory } : {}),
    },
    comments: input.comment ? [...task.comments, { at: ts, author: actor.name, text: input.comment }] : task.comments,
    version: task.version + 1,
  }
  const ok = await store.collection('human_tasks').updateOne({ taskId, version: task.version, status: 'PENDING' }, decided)
  if (!ok) throw new EngineError('Il task è stato modificato da un altro utente', 409, 'CONFLICT')

  const settings = await getSettings(store)
  const delay = STEP_DELAY_MS[settings.simulationSpeed]
  const stepOut = { decision: input.decision, approver: actor.name, comment: input.comment, taskId }
  let next: WorkflowInstance

  if (input.decision === 'APPROVED') {
    let steps = inst.steps.map((s, i) => (i === idx ? { ...s, status: 'COMPLETED' as const, completedAt: ts, output: stepOut } : s))
    next = { ...inst, steps, status: 'RUNNING', nextRunAt: nowPlus(delay) }
    if (triageCategory) {
      const def = await getDefinition(store, CATEGORY_WORKFLOW[triageCategory])
      const keep = steps.slice(0, 2)
      steps = [...keep, ...def.steps.slice(2).map(freshStep)]
      steps[1] = { ...steps[1], output: { ...(steps[1].output ?? {}), manualOverride: triageCategory, triageTaskId: taskId } }
      next = {
        ...next,
        steps,
        workflowId: def.workflowId,
        workflowName: def.name,
        executionMode: def.executionMode,
        slaMinutes: def.slaMinutes,
        retryPolicy: def.retryPolicy,
        currentStepIndex: 2,
        context: { ...inst.context, category: triageCategory, approvalRequired: false, triagedBy: actor.name },
        failureInjection: inst.failureInjection?.remaining === 99 ? { remaining: def.retryPolicy.maxAttempts } : inst.failureInjection,
      }
      await updateTicket(store, inst.ticketId, { category: triageCategory, workflowId: def.workflowId, status: 'IN_PROGRESS' }, `Triage manuale di ${actor.name}: ${triageCategory}`)
    } else {
      next = { ...next, currentStepIndex: findNextRunnable(steps, idx + 1) }
      await updateTicket(store, inst.ticketId, { status: 'IN_PROGRESS' }, `Approvato da ${actor.name}${input.comment ? `: ${input.comment}` : ''}`)
    }
  } else if (input.decision === 'REJECTED') {
    const errIdx = inst.steps.findIndex((s) => s.type === 'error_handler')
    const steps = inst.steps.map((s, i) =>
      i === idx
        ? { ...s, status: 'FAILED' as const, completedAt: ts, output: stepOut, error: 'Respinto in approvazione' }
        : i === errIdx
          ? { ...s, status: 'COMPLETED' as const, attempts: 1, startedAt: ts, completedAt: ts, output: { rejectionPath: 'escalate', rejectedBy: actor.name } }
          : s,
    )
    next = { ...inst, steps, status: 'CANCELLED', nextRunAt: null, completedAt: ts }
    await updateTicket(store, inst.ticketId, { status: 'ESCALATED', resolution: `Respinto da ${actor.name}: ${input.comment || 'nessuna motivazione'}` }, 'Richiesta respinta in approvazione')
    await store.collection('notifications').insertOne({
      notificationId: `NTF-${inst.instanceId}-rejected`,
      ticketId: inst.ticketId,
      instanceId: inst.instanceId,
      agencyId: inst.agencyId,
      agencyName: inst.agencyName,
      recipient: `${inst.agencyId.toLowerCase()}@agenzie.demo.invalid`,
      channel: 'EMAIL',
      subject: `[${inst.ticketId}] Richiesta non approvata`,
      message: `La richiesta non è stata approvata da ${actor.name}. Motivazione: ${input.comment || 'n/d'}`,
      artifactIds: [],
      deliveryStatus: 'DELIVERED',
      simulated: true,
      timestamp: ts,
      deliveredAt: ts,
    })
  } else {
    // CHANGES_REQUESTED → re-run from the latest document generation step with a new revision.
    let restartIdx = -1
    for (let i = idx - 1; i >= 0; i--) if (inst.steps[i].type === 'document_generation') { restartIdx = i; break }
    if (restartIdx === -1) restartIdx = idx
    const steps = inst.steps.map((s, i) =>
      i === idx ? { ...s, status: 'PENDING' as const, output: stepOut, attempts: 0, startedAt: null, completedAt: null } : i >= restartIdx && i < idx ? { ...freshStep({ id: s.stepId, type: s.type, label: s.label, handler: '', config: {} }) } : s,
    )
    next = { ...inst, steps, status: 'RUNNING', revision: inst.revision + 1, currentStepIndex: restartIdx, nextRunAt: nowPlus(delay) }
    await updateTicket(store, inst.ticketId, { status: 'IN_PROGRESS' }, `Modifiche richieste da ${actor.name}: ${input.comment || 'n/d'} (revisione ${inst.revision + 1})`)
  }

  const saved = await saveInstance(store, inst, next)
  if (!saved) throw new EngineError('Conflitto di concorrenza sull’istanza: riprovare', 409, 'CONFLICT')

  await publishInternal(store, {
    eventId: `EVT-HR-${taskId}`,
    eventType: 'HumanResponseReceived',
    topic: 'automation.human.response',
    correlationId: inst.correlationId,
    ticketId: inst.ticketId,
    workflowInstanceId: inst.instanceId,
    agencyId: inst.agencyId,
    agencyName: inst.agencyName,
    payload: { taskId, decision: input.decision, approver: actor.name, comment: input.comment, overrideCategory: triageCategory },
    metadata: {},
  })
  await workflowEvent(store, saved, 'HUMAN_DECISION', `${input.decision} da ${actor.name}`, task.stepId, stepOut)
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: task.agencyId,
    instanceId: task.instanceId,
    ticketId: task.ticketId,
    action: `HUMAN_TASK_${input.decision}`,
    eventType: 'HUMAN_TASK',
    previousState: inst.status,
    newState: saved.status,
    correlationId: inst.correlationId,
    outcome: input.decision === 'APPROVED' ? 'SUCCESS' : 'INFO',
    details: input.comment || null,
  })
  if (settings.simulationSpeed === 'instant' && !settings.paused && saved.status === 'RUNNING') await runInstance(deps, saved.instanceId)
  return decided
}

export async function commentTask(deps: EngineDeps, taskId: string, text: string, actor: Actor): Promise<HumanTask> {
  const { store } = deps
  const task = await store.collection('human_tasks').findOne({ taskId })
  if (!task) throw new EngineError('Task non trovato', 404, 'NOT_FOUND')
  if (actor.role === 'viewer') throw new EngineError('Utente non autorizzato a commentare', 403, 'FORBIDDEN')
  const comments = [...task.comments, { at: new Date().toISOString(), author: actor.name, text }]
  await store.collection('human_tasks').updateOne({ taskId }, { comments })
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: task.agencyId,
    instanceId: task.instanceId,
    ticketId: task.ticketId,
    action: 'HUMAN_TASK_COMMENT',
    eventType: 'HUMAN_TASK',
    previousState: null,
    newState: null,
    correlationId: null,
    outcome: 'INFO',
    details: text.slice(0, 200),
  })
  return { ...task, comments }
}

function requireOperator(actor: Actor) {
  if (actor.role === 'viewer') throw new EngineError('Utente non autorizzato a eseguire azioni operative', 403, 'FORBIDDEN')
}

export async function retryInstance(deps: EngineDeps, instanceId: string, actor: Actor): Promise<WorkflowInstance> {
  requireOperator(actor)
  const { store } = deps
  const inst = await store.collection('workflow_instances').findOne({ instanceId })
  if (!inst) throw new EngineError('Istanza non trovata', 404, 'NOT_FOUND')
  if (inst.status !== 'FAILED') throw new EngineError(`Retry consentito solo per istanze FAILED (stato attuale ${inst.status})`, 409, 'INVALID_STATE')
  const failedIdx = inst.steps.findIndex((s) => s.status === 'FAILED' && s.type !== 'error_handler')
  if (failedIdx === -1) throw new EngineError('Nessuno step fallito da ripetere', 409, 'INVALID_STATE')
  const settings = await getSettings(store)
  const steps = inst.steps.map((s, i) =>
    i === failedIdx ? { ...s, status: 'PENDING' as const, attempts: 0, error: null, completedAt: null } : s.type === 'error_handler' ? { ...s, status: 'PENDING' as const, output: null } : s,
  )
  const saved = await saveInstance(store, inst, {
    ...inst,
    steps,
    status: 'RUNNING',
    currentStepIndex: failedIdx,
    failureInjection: null,
    nextRunAt: nowPlus(STEP_DELAY_MS[settings.simulationSpeed]),
    completedAt: null,
  })
  if (!saved) throw new EngineError('Conflitto di concorrenza: riprovare', 409, 'CONFLICT')
  await updateTicket(store, inst.ticketId, { status: 'IN_PROGRESS' }, `Retry manuale avviato da ${actor.name}`)
  await workflowEvent(store, saved, 'MANUAL_RETRY', `Retry manuale da ${actor.name} sullo step ${inst.steps[failedIdx].label}`, inst.steps[failedIdx].stepId)
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: inst.agencyId,
    instanceId,
    ticketId: inst.ticketId,
    action: 'WORKFLOW_MANUAL_RETRY',
    eventType: 'WORKFLOW',
    previousState: 'FAILED',
    newState: 'RUNNING',
    correlationId: inst.correlationId,
    outcome: 'SUCCESS',
    details: 'Iniezione guasto rimossa: causa tecnica risolta',
  })
  if (settings.simulationSpeed === 'instant' && !settings.paused) await runInstance(deps, instanceId)
  return saved
}

export async function cancelInstance(deps: EngineDeps, instanceId: string, actor: Actor, reason = ''): Promise<WorkflowInstance> {
  requireOperator(actor)
  const { store } = deps
  const inst = await store.collection('workflow_instances').findOne({ instanceId })
  if (!inst) throw new EngineError('Istanza non trovata', 404, 'NOT_FOUND')
  if (TERMINAL.has(inst.status)) throw new EngineError(`Istanza già in stato terminale (${inst.status})`, 409, 'INVALID_STATE')
  const saved = await saveInstance(store, inst, { ...inst, status: 'CANCELLED', nextRunAt: null, completedAt: new Date().toISOString() })
  if (!saved) throw new EngineError('Conflitto di concorrenza: riprovare', 409, 'CONFLICT')
  const pending = await store.collection('human_tasks').find({ instanceId, status: 'PENDING' })
  for (const t of pending) await store.collection('human_tasks').updateOne({ taskId: t.taskId }, { status: 'CANCELLED', decidedAt: new Date().toISOString() })
  await updateTicket(store, inst.ticketId, { status: 'ESCALATED', resolution: `Workflow annullato da ${actor.name}${reason ? `: ${reason}` : ''}` }, 'Workflow annullato')
  await workflowEvent(store, saved, 'INSTANCE_CANCELLED', `Annullato da ${actor.name}`)
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: inst.agencyId,
    instanceId,
    ticketId: inst.ticketId,
    action: 'WORKFLOW_CANCELLED',
    eventType: 'WORKFLOW',
    previousState: inst.status,
    newState: 'CANCELLED',
    correlationId: inst.correlationId,
    outcome: 'INFO',
    details: reason || null,
  })
  return saved
}

export async function resumeInstance(deps: EngineDeps, instanceId: string, actor: Actor): Promise<WorkflowInstance> {
  requireOperator(actor)
  const { store } = deps
  const inst = await store.collection('workflow_instances').findOne({ instanceId })
  if (!inst) throw new EngineError('Istanza non trovata', 404, 'NOT_FOUND')
  if (inst.status === 'WAITING_FOR_HUMAN') throw new EngineError('L’istanza attende una decisione umana: usare Human Tasks', 409, 'WAITING_FOR_HUMAN')
  if (!['RETRYING', 'RUNNING', 'PENDING'].includes(inst.status)) throw new EngineError(`Resume non applicabile allo stato ${inst.status}`, 409, 'INVALID_STATE')
  const saved = await saveInstance(store, inst, { ...inst, nextRunAt: new Date().toISOString() })
  if (!saved) throw new EngineError('Conflitto di concorrenza: riprovare', 409, 'CONFLICT')
  await workflowEvent(store, saved, 'RESUMED', `Esecuzione forzata da ${actor.name}`)
  await executeStep(deps, instanceId, await getSettings(store))
  return (await store.collection('workflow_instances').findOne({ instanceId })) ?? saved
}

/** Replays a Kafka message. Ticket-created events are re-delivered with a new eventId but keep the ticket key, so the consumer deduplicates. */
export async function replayMessage(deps: EngineDeps, eventId: string, actor: Actor): Promise<{ replay: KafkaMessage; outcome: string }> {
  requireOperator(actor)
  const { store } = deps
  const original = await store.collection('kafka_messages').findOne({ eventId })
  if (!original) throw new EngineError('Messaggio non trovato', 404, 'NOT_FOUND')
  const replayId = randomId('EVT')
  const offset = await store.collection('kafka_messages').count({ topic: original.topic })
  const replay: KafkaMessage = {
    ...original,
    eventId: replayId,
    timestamp: new Date().toISOString(),
    replayOf: original.eventId,
    consumerStatus: original.topic === 'remedy.ticket.created' ? 'PENDING' : 'CONSUMED',
    consumerError: null,
    offset,
    metadata: { ...original.metadata, replayedBy: actor.name },
  }
  await store.collection('kafka_messages').insertOne(replay)
  let outcome = 'Messaggio ripubblicato (nessun consumer con effetti collaterali per questo topic)'
  if (replay.topic === 'remedy.ticket.created') {
    await consumeTicketMessage(deps, replay)
    const after = await store.collection('kafka_messages').findOne({ eventId: replayId })
    outcome =
      after?.consumerStatus === 'SKIPPED_DUPLICATE'
        ? `Idempotenza: ticket ${original.ticketId} già in lavorazione, nessun workflow duplicato`
        : 'Messaggio consumato: nuovo workflow avviato'
  }
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: original.agencyId,
    instanceId: original.workflowInstanceId,
    ticketId: original.ticketId,
    action: 'KAFKA_EVENT_REPLAYED',
    eventType: 'KAFKA',
    previousState: null,
    newState: null,
    correlationId: original.correlationId,
    outcome: 'INFO',
    details: outcome,
  })
  return { replay: (await store.collection('kafka_messages').findOne({ eventId: replayId })) ?? replay, outcome }
}
