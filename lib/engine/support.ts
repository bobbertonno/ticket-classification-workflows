import type {
  AppSettings,
  AuditLog,
  KafkaMessage,
  RemedyTicket,
  SimulationSpeed,
  TicketStatus,
  WorkflowEvent,
  WorkflowInstance,
} from '@/lib/domain/schemas'
import { CATEGORIES } from '@/lib/domain/schemas'
import { randomId } from '@/lib/domain/ids'
import type { DataStore } from '@/lib/store/types'

export interface Actor {
  id: string
  name: string
  role: 'admin' | 'approver' | 'viewer'
  team: string
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Automation Engine', role: 'admin', team: 'Platform' }

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'app',
  simulationSpeed: 'normal',
  paused: false,
  defaultAgencyId: 'MI001',
  autoClassification: true,
  injectFailureNext: false,
  datasetSize: 'medium',
  approvalPolicies: Object.fromEntries(CATEGORIES.map((c) => [c, true])),
  decisionPolicy: { minTopScore: 0.4, minMargin: 0.03, topK: 5 },
}

export const STEP_DELAY_MS: Record<SimulationSpeed, number> = { instant: 0, fast: 700, normal: 2000, slow: 4500 }
export const SPEED_FACTOR: Record<SimulationSpeed, number> = { instant: 0, fast: 0.5, normal: 1, slow: 2 }

export async function getSettings(store: DataStore): Promise<AppSettings> {
  const s = await store.collection('app_settings').findOne({ key: 'app' })
  return s ? { ...DEFAULT_SETTINGS, ...s, decisionPolicy: { ...DEFAULT_SETTINGS.decisionPolicy, ...s.decisionPolicy } } : DEFAULT_SETTINGS
}

export async function audit(
  store: DataStore,
  entry: Omit<AuditLog, 'eventId' | 'timestamp'> & { eventId?: string },
): Promise<void> {
  await store.collection('audit_logs').insertOne({
    ...entry,
    eventId: entry.eventId ?? randomId('AUD'),
    timestamp: new Date().toISOString(),
  })
}

export async function workflowEvent(
  store: DataStore,
  inst: Pick<WorkflowInstance, 'instanceId' | 'correlationId'>,
  type: string,
  message: string,
  stepId: string | null = null,
  data: Record<string, unknown> | null = null,
  eventId?: string,
): Promise<void> {
  const ev: WorkflowEvent = {
    eventId: eventId ?? randomId('WFE'),
    instanceId: inst.instanceId,
    correlationId: inst.correlationId,
    stepId,
    type,
    message,
    data,
    timestamp: new Date().toISOString(),
  }
  await store.collection('workflow_events').insertOne(ev)
}

/** Idempotent outbox-style publication: deterministic eventIds make re-publication a no-op. */
export async function publishInternal(
  store: DataStore,
  msg: Omit<KafkaMessage, 'timestamp' | 'partition' | 'offset' | 'schemaVersion' | 'consumerStatus' | 'consumerError' | 'replayOf'> &
    Partial<Pick<KafkaMessage, 'consumerStatus' | 'replayOf'>>,
): Promise<boolean> {
  const offset = await store.collection('kafka_messages').count({ topic: msg.topic })
  return store.collection('kafka_messages').insertOne({
    schemaVersion: '1.2',
    consumerStatus: 'CONSUMED',
    consumerError: null,
    replayOf: null,
    ...msg,
    timestamp: new Date().toISOString(),
    partition: Math.abs(hashCode(msg.correlationId)) % 3,
    offset,
  })
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export async function updateTicket(
  store: DataStore,
  ticketId: string,
  patch: Partial<RemedyTicket>,
  note?: string,
): Promise<RemedyTicket | null> {
  const t = await store.collection('remedy_tickets').findOne({ ticketId })
  if (!t) return null
  const now = new Date().toISOString()
  const timeline = [...t.timeline]
  const newStatus: TicketStatus = patch.status ?? t.status
  if (patch.status && patch.status !== t.status) timeline.push({ at: now, status: patch.status, note: note ?? '' })
  else if (note) timeline.push({ at: now, status: newStatus, note })
  const next = { ...t, ...patch, timeline, updatedAt: now }
  await store.collection('remedy_tickets').updateOne({ ticketId }, next)
  if (patch.status && patch.status !== t.status) {
    await audit(store, {
      actor: SYSTEM_ACTOR.name,
      actorType: 'SYSTEM',
      agencyId: t.agencyId,
      instanceId: t.instanceId,
      ticketId,
      action: 'TICKET_STATUS_CHANGED',
      eventType: 'TICKET',
      previousState: t.status,
      newState: patch.status,
      correlationId: t.correlationId,
      outcome: patch.status === 'FAILED' || patch.status === 'ESCALATED' ? 'FAILURE' : 'SUCCESS',
      details: note ?? null,
    })
  }
  return next
}

/** Atomic compare-and-set on the instance version (optimistic concurrency). */
export async function saveInstance(store: DataStore, prev: WorkflowInstance, next: WorkflowInstance): Promise<WorkflowInstance | null> {
  const saved: WorkflowInstance = { ...next, version: prev.version + 1, updatedAt: new Date().toISOString() }
  const ok = await store.collection('workflow_instances').updateOne({ instanceId: prev.instanceId, version: prev.version }, saved)
  return ok ? saved : null
}
