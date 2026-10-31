import { hash32, prng } from '@/lib/domain/ids'
import type {
  AppSettings,
  Category,
  ClassificationResult,
  CollectionName,
  KafkaMessage,
  RemedyTicket,
  StepState,
  WorkflowInstance,
} from '@/lib/domain/schemas'
import { AGENCIES, CATEGORY_WORKFLOW, KNOWLEDGE_BASE, WORKFLOW_DEFINITIONS } from '@/lib/domain/seed-data'
import type { DataStore } from '@/lib/store/types'
import { DEFAULT_SETTINGS, audit, getSettings } from './support'

export const DATASET_SIZES: Record<AppSettings['datasetSize'], number> = { small: 24, medium: 60, large: 150 }

const HISTORY_CATEGORIES: [Category, number][] = [
  ['CLAIMS_REPORT', 18],
  ['POLICY_DOCUMENT_RETRIEVAL', 22],
  ['ACCESS_PROVISIONING', 10],
  ['CLAIM_STATUS_INQUIRY', 16],
  ['PAYMENT_REPORT', 9],
  ['CUSTOMER_DATA_UPDATE', 8],
  ['DOCUMENT_GENERATION', 8],
  ['TECHNICAL_SUPPORT', 6],
  ['COMPLIANCE_REQUEST', 3],
]
const AGENCY_WEIGHTS = [16, 13, 11, 10, 9, 8, 6, 5]

function pickWeighted<T>(rnd: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rnd() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

export async function isInitialized(store: DataStore): Promise<boolean> {
  return (await store.collection('app_settings').count({ key: 'app' })) > 0
}

/** Loads reference data (agencies, workflows, knowledge base) and a deterministic synthetic history. */
export async function seedDatabase(store: DataStore, size?: AppSettings['datasetSize'], keepSettings?: AppSettings): Promise<{ inserted: Record<string, number> }> {
  const inserted: Record<string, number> = {}
  inserted.agencies = await store.collection('agencies').insertMany(AGENCIES)
  inserted.workflow_definitions = await store.collection('workflow_definitions').insertMany(WORKFLOW_DEFINITIONS)
  inserted.workflow_classification_knowledge = await store.collection('workflow_classification_knowledge').insertMany(KNOWLEDGE_BASE)

  const settings: AppSettings = { ...(keepSettings ?? DEFAULT_SETTINGS), datasetSize: size ?? keepSettings?.datasetSize ?? 'medium', paused: false, injectFailureNext: false }
  await store.collection('app_settings').deleteMany({ key: 'app' })
  await store.collection('app_settings').insertOne(settings)

  const n = DATASET_SIZES[settings.datasetSize]
  const rnd = prng(hash32(`history:${settings.datasetSize}`))
  const now = Date.now()
  const tickets: RemedyTicket[] = []
  const instances: WorkflowInstance[] = []
  const classifications: ClassificationResult[] = []
  const messages: KafkaMessage[] = []

  for (let i = 0; i < n; i++) {
    const agency = pickWeighted(rnd, AGENCIES, AGENCY_WEIGHTS)
    const category = pickWeighted(rnd, HISTORY_CATEGORIES.map((c) => c[0]), HISTORY_CATEGORIES.map((c) => c[1]))
    const def = WORKFLOW_DEFINITIONS.find((w) => w.workflowId === CATEGORY_WORKFLOW[category])!
    const created = new Date(now - (1 + rnd() * 13.5) * 86_400_000)
    const durationMin = def.executionMode === 'HITL' ? 25 + rnd() * 260 : 1 + rnd() * 22
    const failed = rnd() < 0.07
    const completedAt = new Date(created.getTime() + durationMin * 60_000)
    const ticketId = `INC0009${String(10000 + i).padStart(5, '0')}`
    const instanceId = `WFI-HIST-${String(i + 1).padStart(4, '0')}`
    const correlationId = `COR-HIST-${String(i + 1).padStart(4, '0')}`
    const example = KNOWLEDGE_BASE.find((k) => k.category === category)!
    const failIdx = failed ? def.steps.findIndex((s) => s.type === 'document_generation' || s.type === 'api_call') : -1

    const steps: StepState[] = def.steps.map((s, idx) => {
      const status: StepState['status'] =
        s.type === 'error_handler' ? (failed ? 'COMPLETED' : 'SKIPPED') : failed && idx > failIdx ? 'PENDING' : failed && idx === failIdx ? 'FAILED' : 'COMPLETED'
      const at = new Date(created.getTime() + ((idx + 1) / def.steps.length) * durationMin * 60_000).toISOString()
      return {
        stepId: s.id,
        type: s.type,
        label: s.label,
        status,
        attempts: status === 'PENDING' ? 0 : status === 'FAILED' ? def.retryPolicy.maxAttempts : 1,
        startedAt: status === 'PENDING' ? null : at,
        completedAt: status === 'PENDING' ? null : at,
        input: null,
        output: s.type === 'human_approval' && status === 'COMPLETED' ? { decision: 'APPROVED', approver: 'Team di approvazione (storico)' } : null,
        error: status === 'FAILED' ? 'Timeout servizio a valle (storico sintetico)' : null,
      }
    })

    tickets.push({
      ticketId,
      agencyId: agency.agencyId,
      agencyName: agency.agencyName,
      operatorId: agency.operatorId,
      operatorName: agency.operatorName,
      subject: example.exampleRequest.slice(0, 80),
      description: example.exampleRequest,
      category,
      priority: rnd() < 0.15 ? 'HIGH' : rnd() < 0.1 ? 'LOW' : 'MEDIUM',
      status: failed ? 'ESCALATED' : 'CLOSED',
      createdAt: created.toISOString(),
      updatedAt: completedAt.toISOString(),
      workflowId: def.workflowId,
      instanceId,
      correlationId,
      resolution: failed ? 'Escalation al supporto di secondo livello (storico sintetico)' : `Evasa tramite ${def.name} (storico sintetico)`,
      artifactIds: [],
      notificationStatus: failed ? 'NONE' : 'DELIVERED',
      timeline: [
        { at: created.toISOString(), status: 'NEW', note: 'Record storico sintetico' },
        { at: completedAt.toISOString(), status: failed ? 'ESCALATED' : 'CLOSED', note: 'Record storico sintetico' },
      ],
      seeded: true,
    })
    instances.push({
      instanceId,
      workflowId: def.workflowId,
      workflowName: def.name,
      ticketId,
      agencyId: agency.agencyId,
      agencyName: agency.agencyName,
      correlationId,
      status: failed ? 'FAILED' : 'COMPLETED',
      executionMode: def.executionMode,
      currentStepIndex: failed ? failIdx : def.steps.length - 2,
      steps,
      context: { category, artifactIds: [], notificationDelivered: !failed, historical: true },
      slaMinutes: def.slaMinutes,
      retryPolicy: def.retryPolicy,
      failureInjection: null,
      revision: 1,
      nextRunAt: null,
      version: 1,
      createdAt: created.toISOString(),
      updatedAt: completedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      seeded: true,
    })
    classifications.push({
      classificationId: `CLS-${instanceId}`,
      ticketId,
      instanceId,
      agencyId: agency.agencyId,
      normalizedText: example.exampleRequest.toLowerCase(),
      selectedCategory: category,
      selectedWorkflow: def.workflowId,
      semanticMatches: [],
      categoryScores: [],
      similarityScores: [],
      method: 'SIMULATED_DETERMINISTIC',
      simulated: true,
      modelName: 'storico sintetico',
      modelVersion: null,
      rerankModel: null,
      classificationTimestamp: created.toISOString(),
      extractedParameters: {},
      policyDecision: { authorized: true, reasons: ['Record storico sintetico'], approvalRequired: def.approvalPolicy.required, rule: 'storico' },
      humanReviewRequired: false,
      decisionRule: 'Record storico sintetico (nessuna evidenza semantica)',
      fallbackReason: null,
    })
    messages.push({
      eventId: `EVT-HIST-${String(i + 1).padStart(4, '0')}`,
      eventType: 'RemedyTicketCreated',
      topic: 'remedy.ticket.created',
      timestamp: created.toISOString(),
      correlationId,
      ticketId,
      workflowInstanceId: instanceId,
      agencyId: agency.agencyId,
      agencyName: agency.agencyName,
      payload: { subject: example.exampleRequest.slice(0, 80), description: example.exampleRequest, priority: 'MEDIUM', requestedBy: agency.operatorName },
      metadata: { source: 'seed-history', synthetic: true },
      schemaVersion: '1.2',
      consumerStatus: 'CONSUMED',
      consumerError: null,
      replayOf: null,
      partition: i % 3,
      offset: i,
    })
  }
  inserted.remedy_tickets = await store.collection('remedy_tickets').insertMany(tickets)
  inserted.workflow_instances = await store.collection('workflow_instances').insertMany(instances)
  inserted.classification_results = await store.collection('classification_results').insertMany(classifications)
  inserted.kafka_messages = await store.collection('kafka_messages').insertMany(messages)
  return { inserted }
}

export async function ensureSeeded(store: DataStore): Promise<void> {
  if (!(await isInitialized(store))) await seedDatabase(store)
}

const RESETTABLE: CollectionName[] = [
  'remedy_tickets',
  'workflow_instances',
  'workflow_events',
  'human_tasks',
  'kafka_messages',
  'classification_results',
  'notifications',
  'artifacts',
  'audit_logs',
  'agencies',
  'workflow_definitions',
]

/** Resets ONLY the selected environment's application collections, then reloads synthetic data. Voyage embeddings in the KB are preserved. */
export async function resetDemo(store: DataStore, actorName: string): Promise<Record<string, number>> {
  const settings = await getSettings(store)
  const deleted: Record<string, number> = {}
  for (const c of RESETTABLE) deleted[c] = await store.collection(c).deleteMany({})
  await seedDatabase(store, settings.datasetSize, settings)
  await audit(store, {
    actor: actorName,
    actorType: 'USER',
    agencyId: null,
    instanceId: null,
    ticketId: null,
    action: 'DEMO_RESET',
    eventType: 'DEMO',
    previousState: null,
    newState: null,
    correlationId: null,
    outcome: 'SUCCESS',
    details: `Reset ambiente ${store.databaseName}: ${Object.values(deleted).reduce((a, b) => a + b, 0)} documenti rimossi`,
  })
  return deleted
}
