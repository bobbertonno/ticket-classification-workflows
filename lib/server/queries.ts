import 'server-only'
import type { DataStore } from '@/lib/store/types'
import type { AuditLog, HumanTask, KafkaMessage, RemedyTicket, WorkflowInstance } from '@/lib/domain/schemas'
import { TOPICS } from '@/lib/domain/schemas'

const byDesc = <T,>(key: keyof T) => (a: T, b: T) => String(b[key]).localeCompare(String(a[key]))

function sp(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key)
  return v && v !== 'all' ? v : undefined
}

export async function listTickets(store: DataStore, url: URL) {
  const agencyId = sp(url, 'agencyId')
  const status = sp(url, 'status') as RemedyTicket['status'] | undefined
  const q = sp(url, 'q')?.toLowerCase()
  let list = await store.collection('remedy_tickets').find({ ...(agencyId ? { agencyId } : {}), ...(status ? { status } : {}) })
  if (q) list = list.filter((t) => `${t.ticketId} ${t.subject} ${t.description} ${t.operatorName} ${t.agencyName}`.toLowerCase().includes(q))
  return list.sort(byDesc('createdAt')).slice(0, 300)
}

export async function ticketDetail(store: DataStore, ticketId: string) {
  const ticket = await store.collection('remedy_tickets').findOne({ ticketId })
  if (!ticket) return null
  const [agency, classifications, instances, artifacts, notifications, messages, tasks] = await Promise.all([
    store.collection('agencies').findOne({ agencyId: ticket.agencyId }),
    store.collection('classification_results').find({ ticketId }),
    store.collection('workflow_instances').find({ ticketId }),
    store.collection('artifacts').find({ ticketId }),
    store.collection('notifications').find({ ticketId }),
    store.collection('kafka_messages').find({ ticketId }),
    store.collection('human_tasks').find({ ticketId }),
  ])
  return {
    ticket,
    agency,
    classification: classifications.sort(byDesc('classificationTimestamp'))[0] ?? null,
    instances: instances.sort(byDesc('createdAt')),
    artifacts: artifacts.sort(byDesc('createdAt')),
    notifications: notifications.sort(byDesc('timestamp')),
    messages: messages.sort(byDesc('timestamp')),
    tasks: tasks.sort(byDesc('createdAt')),
  }
}

export async function listExecutions(store: DataStore, url: URL) {
  const agencyId = sp(url, 'agencyId')
  const status = sp(url, 'status') as WorkflowInstance['status'] | undefined
  const workflowId = sp(url, 'workflowId')
  const mode = sp(url, 'mode') as WorkflowInstance['executionMode'] | undefined
  const list = await store.collection('workflow_instances').find({
    ...(agencyId ? { agencyId } : {}),
    ...(status ? { status } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(mode ? { executionMode: mode } : {}),
  })
  return list
    .sort(byDesc('createdAt'))
    .slice(0, 300)
    .map(({ context: _context, ...rest }) => ({ ...rest, steps: rest.steps.map((s) => ({ stepId: s.stepId, type: s.type, label: s.label, status: s.status, attempts: s.attempts })) }))
}

export async function executionDetail(store: DataStore, instanceId: string) {
  const instance = await store.collection('workflow_instances').findOne({ instanceId })
  if (!instance) return null
  const [definition, events, tasks, artifacts, notifications, messages, classifications, ticket] = await Promise.all([
    store.collection('workflow_definitions').findOne({ workflowId: instance.workflowId }),
    store.collection('workflow_events').find({ instanceId }),
    store.collection('human_tasks').find({ instanceId }),
    store.collection('artifacts').find({ instanceId }),
    store.collection('notifications').find({ instanceId }),
    store.collection('kafka_messages').find({ correlationId: instance.correlationId }),
    store.collection('classification_results').find({ ticketId: instance.ticketId }),
    store.collection('remedy_tickets').findOne({ ticketId: instance.ticketId }),
  ])
  return {
    instance,
    definition,
    ticket,
    events: events.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    tasks: tasks.sort(byDesc('createdAt')),
    artifacts: artifacts.sort(byDesc('createdAt')),
    notifications: notifications.sort(byDesc('timestamp')),
    messages: messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    classification: classifications.sort(byDesc('classificationTimestamp'))[0] ?? null,
  }
}

export async function listHumanTasks(store: DataStore, url: URL) {
  const status = sp(url, 'status') as HumanTask['status'] | undefined
  const agencyId = sp(url, 'agencyId')
  const list = await store.collection('human_tasks').find({ ...(status ? { status } : {}), ...(agencyId ? { agencyId } : {}) })
  const now = Date.now()
  return list
    .sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200)
    .map((t) => {
      const due = new Date(t.dueAt).getTime()
      const slaStatus = t.status !== 'PENDING' ? 'CLOSED' : due < now ? 'BREACHED' : due - now < 30 * 60_000 ? 'AT_RISK' : 'ON_TRACK'
      return { ...t, slaStatus }
    })
}

export async function kafkaOverview(store: DataStore, url: URL) {
  const topic = sp(url, 'topic')
  const all = await store.collection('kafka_messages').find()
  const topics = TOPICS.map((t) => {
    const msgs = all.filter((m) => m.topic === t)
    const last = msgs.sort(byDesc<KafkaMessage>('timestamp'))[0] ?? null
    return {
      topic: t,
      messageCount: msgs.length,
      lastPublishedAt: last?.timestamp ?? null,
      lastEventType: last?.eventType ?? null,
      consumed: msgs.filter((m) => m.consumerStatus === 'CONSUMED').length,
      pending: msgs.filter((m) => m.consumerStatus === 'PENDING').length,
      failed: msgs.filter((m) => m.consumerStatus === 'FAILED' || m.consumerStatus === 'DEAD_LETTER').length,
      duplicates: msgs.filter((m) => m.consumerStatus === 'SKIPPED_DUPLICATE').length,
    }
  })
  const messages = (topic ? all.filter((m) => m.topic === topic) : all).sort(byDesc('timestamp')).slice(0, 200)
  return { topics, messages }
}

export async function listAudit(store: DataStore, url: URL) {
  const f = {
    ticketId: sp(url, 'ticketId'),
    instanceId: sp(url, 'instanceId'),
    agencyId: sp(url, 'agencyId'),
    eventType: sp(url, 'eventType') as AuditLog['eventType'] | undefined,
  }
  const filter = Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Partial<AuditLog>
  const actor = sp(url, 'actor')?.toLowerCase()
  const from = sp(url, 'from')
  const to = sp(url, 'to')
  let list = await store.collection('audit_logs').find(filter)
  if (actor) list = list.filter((a) => a.actor.toLowerCase().includes(actor))
  if (from) list = list.filter((a) => a.timestamp >= from)
  if (to) list = list.filter((a) => a.timestamp <= `${to}T23:59:59.999Z`)
  const workflowId = sp(url, 'workflowId')
  if (workflowId) {
    const ids = new Set((await store.collection('workflow_instances').find({ workflowId })).map((i) => i.instanceId))
    list = list.filter((a) => a.instanceId && ids.has(a.instanceId))
  }
  return list.sort(byDesc('timestamp')).slice(0, 500)
}

export async function listNotifications(store: DataStore, url: URL) {
  const q = sp(url, 'q')?.toLowerCase()
  const channel = sp(url, 'channel')
  let list = await store.collection('notifications').find(channel ? { channel: channel as never } : {})
  if (q) list = list.filter((n) => `${n.ticketId} ${n.recipient} ${n.subject} ${n.message} ${n.agencyName}`.toLowerCase().includes(q))
  return list.sort(byDesc('timestamp')).slice(0, 300)
}
