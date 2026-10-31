import { z } from 'zod'

export const CATEGORIES = [
  'CLAIMS_REPORT',
  'POLICY_DOCUMENT_RETRIEVAL',
  'ACCESS_PROVISIONING',
  'CUSTOMER_DATA_UPDATE',
  'CLAIM_STATUS_INQUIRY',
  'PAYMENT_REPORT',
  'DOCUMENT_GENERATION',
  'TECHNICAL_SUPPORT',
  'COMPLIANCE_REQUEST',
  'UNKNOWN',
] as const
export const CategorySchema = z.enum(CATEGORIES)
export type Category = z.infer<typeof CategorySchema>

export const TOPICS = [
  'remedy.ticket.created',
  'automation.execution.requested',
  'automation.task.completed',
  'automation.human.response',
  'automation.notification.outbound',
  'automation.execution.failed',
  'automation.dead-letter',
] as const
export const TopicSchema = z.enum(TOPICS)
export type Topic = z.infer<typeof TopicSchema>

export const TICKET_STATUSES = [
  'NEW',
  'CLASSIFYING',
  'CLASSIFIED',
  'IN_PROGRESS',
  'WAITING_FOR_APPROVAL',
  'RESOLVED',
  'CLOSED',
  'FAILED',
  'ESCALATED',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const INSTANCE_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_FOR_HUMAN',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'CANCELLED',
] as const
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number]

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export const PrioritySchema = z.enum(PRIORITIES)
export type Priority = z.infer<typeof PrioritySchema>

export type ExecutionMode = 'AUTOMATED' | 'HITL' | 'MANUAL_TRIAGE'

export interface Agency {
  agencyId: string
  agencyName: string
  region: string
  city: string
  geographicArea: 'Nord' | 'Centro' | 'Sud e Isole'
  operatorId: string
  operatorName: string
  status: 'ACTIVE' | 'SUSPENDED'
  synthetic: true
}

export interface TicketTimelineEntry {
  at: string
  status: TicketStatus
  note: string
}

export interface RemedyTicket {
  ticketId: string
  agencyId: string
  agencyName: string
  operatorId: string
  operatorName: string
  subject: string
  description: string
  category: Category | null
  priority: Priority
  status: TicketStatus
  createdAt: string
  updatedAt: string
  workflowId: string | null
  instanceId: string | null
  correlationId: string
  resolution: string | null
  artifactIds: string[]
  notificationStatus: 'NONE' | 'QUEUED' | 'DELIVERED' | 'FAILED'
  timeline: TicketTimelineEntry[]
  seeded: boolean
}

export const STEP_TYPES = [
  'kafka_trigger',
  'classification',
  'condition',
  'api_call',
  'document_generation',
  'human_approval',
  'notification',
  'remedy_update',
  'completion',
  'error_handler',
] as const
export type StepType = (typeof STEP_TYPES)[number]

export interface WorkflowStepDefinition {
  id: string
  type: StepType
  label: string
  handler: string
  config: Record<string, string | number | boolean>
}

export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
}

export interface ApprovalPolicy {
  required: boolean
  approverRole: 'approver' | 'admin'
  assignedTeam: string
  dueInMinutes: number
  onReject: 'escalate' | 'cancel'
}

export interface WorkflowDefinition {
  workflowId: string
  name: string
  description: string
  version: string
  category: Category
  executionMode: ExecutionMode
  triggerTopic: Topic
  steps: WorkflowStepDefinition[]
  slaMinutes: number
  retryPolicy: RetryPolicy
  approvalPolicy: ApprovalPolicy
  status: 'ACTIVE' | 'DRAFT' | 'DEPRECATED'
  updatedAt: string
}

export type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING' | 'SKIPPED'

export interface StepState {
  stepId: string
  type: StepType
  label: string
  status: StepStatus
  attempts: number
  startedAt: string | null
  completedAt: string | null
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  error: string | null
}

export interface WorkflowInstance {
  instanceId: string
  workflowId: string
  workflowName: string
  ticketId: string
  agencyId: string
  agencyName: string
  correlationId: string
  status: InstanceStatus
  executionMode: ExecutionMode
  currentStepIndex: number
  steps: StepState[]
  context: Record<string, unknown>
  slaMinutes: number
  retryPolicy: RetryPolicy
  failureInjection: { remaining: number } | null
  revision: number
  nextRunAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  seeded: boolean
}

export interface WorkflowEvent {
  eventId: string
  instanceId: string
  correlationId: string
  stepId: string | null
  type: string
  message: string
  data: Record<string, unknown> | null
  timestamp: string
}

export type HumanTaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'CANCELLED'

export interface HumanTaskComment {
  at: string
  author: string
  text: string
}

export interface HumanTask {
  taskId: string
  instanceId: string
  stepId: string
  ticketId: string
  agencyId: string
  agencyName: string
  operatorName: string
  approvalType: 'REPORT_APPROVAL' | 'ACCESS_APPROVAL' | 'MANUAL_TRIAGE' | 'DOCUMENT_APPROVAL'
  title: string
  assignedTeam: string
  assignedRole: 'approver' | 'admin'
  assignedTo: string | null
  priority: Priority
  status: HumanTaskStatus
  dueAt: string
  createdAt: string
  decidedAt: string | null
  decision: {
    decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'
    approver: string
    approverId: string
    timestamp: string
    comment: string
    previousState: string
    newState: string
    overrideCategory?: Category
  } | null
  comments: HumanTaskComment[]
  artifactIds: string[]
  suggestedCategory: Category | null
  version: number
}

export type ConsumerStatus = 'PENDING' | 'CONSUMED' | 'FAILED' | 'DEAD_LETTER' | 'SKIPPED_DUPLICATE'

export interface KafkaMessage {
  eventId: string
  eventType: string
  topic: Topic
  timestamp: string
  correlationId: string
  ticketId: string
  workflowInstanceId: string | null
  agencyId: string
  agencyName: string
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  schemaVersion: string
  consumerStatus: ConsumerStatus
  consumerError: string | null
  replayOf: string | null
  partition: number
  offset: number
}

export interface KnowledgeExample {
  exampleId: string
  category: Category
  subcategory: string
  workflowId: string
  description: string
  exampleRequest: string
  embedding?: number[]
  embeddingModel?: string
  language: 'it'
  active: boolean
  version: number
}

export interface SemanticMatch {
  exampleId: string
  category: Category
  subcategory: string
  workflowId: string
  exampleRequest: string
  score: number
  rerankScore?: number
}

export type ClassificationMethod =
  | 'VOYAGE_API_ATLAS_VECTOR_SEARCH'
  | 'VOYAGE_API_IN_MEMORY_SEARCH'
  | 'ATLAS_AUTO_EMBEDDING'
  | 'SIMULATED_DETERMINISTIC'
  | 'KEYWORD'
  | 'HYBRID'

export interface ClassificationResult {
  classificationId: string
  ticketId: string
  instanceId: string | null
  agencyId: string
  normalizedText: string
  selectedCategory: Category
  selectedWorkflow: string
  semanticMatches: SemanticMatch[]
  categoryScores: { category: Category; score: number }[]
  similarityScores: number[]
  method: ClassificationMethod
  simulated: boolean
  modelName: string
  modelVersion: string | null
  rerankModel: string | null
  classificationTimestamp: string
  extractedParameters: Record<string, string | number | boolean>
  policyDecision: {
    authorized: boolean
    reasons: string[]
    approvalRequired: boolean
    rule: string
  }
  humanReviewRequired: boolean
  decisionRule: string
  fallbackReason: string | null
}

export type NotificationChannel = 'EMAIL' | 'REMEDY_COMMENT' | 'WORKFLOW_ALERT'

export interface NotificationRecord {
  notificationId: string
  ticketId: string
  instanceId: string
  agencyId: string
  agencyName: string
  recipient: string
  channel: NotificationChannel
  subject: string
  message: string
  artifactIds: string[]
  deliveryStatus: 'QUEUED' | 'DELIVERED' | 'FAILED'
  simulated: true
  timestamp: string
  deliveredAt: string | null
}

export interface Artifact {
  artifactId: string
  instanceId: string
  ticketId: string
  agencyId: string
  kind: 'CLAIMS_XLSX' | 'PAYMENTS_XLSX' | 'POLICY_PDF' | 'ACCESS_PDF' | 'CERT_PDF'
  fileName: string
  mimeType: string
  params: Record<string, string | number>
  rowCount: number
  contentHash: string
  storage: 'DETERMINISTIC_REGENERATION'
  revision: number
  createdAt: string
}

export interface AuditLog {
  eventId: string
  timestamp: string
  actor: string
  actorType: 'USER' | 'SYSTEM'
  agencyId: string | null
  instanceId: string | null
  ticketId: string | null
  action: string
  eventType: 'KAFKA' | 'TICKET' | 'WORKFLOW' | 'HUMAN_TASK' | 'CLASSIFICATION' | 'NOTIFICATION' | 'ARTIFACT' | 'SETTINGS' | 'DEMO'
  previousState: string | null
  newState: string | null
  correlationId: string | null
  outcome: 'SUCCESS' | 'FAILURE' | 'INFO'
  details: string | null
}

export const SIMULATION_SPEEDS = ['instant', 'fast', 'normal', 'slow'] as const
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number]

export const AppSettingsSchema = z.object({
  simulationSpeed: z.enum(SIMULATION_SPEEDS),
  paused: z.boolean(),
  defaultAgencyId: z.string().min(1),
  autoClassification: z.boolean(),
  injectFailureNext: z.boolean(),
  datasetSize: z.enum(['small', 'medium', 'large']),
  approvalPolicies: z.record(z.string(), z.boolean()),
  decisionPolicy: z.object({
    minTopScore: z.number().min(0).max(1),
    minMargin: z.number().min(0).max(1),
    topK: z.number().int().min(1).max(20),
  }),
})
export type AppSettings = z.infer<typeof AppSettingsSchema> & { key: 'app' }

export interface Collections {
  agencies: Agency
  remedy_tickets: RemedyTicket
  workflow_definitions: WorkflowDefinition
  workflow_instances: WorkflowInstance
  workflow_events: WorkflowEvent
  human_tasks: HumanTask
  kafka_messages: KafkaMessage
  workflow_classification_knowledge: KnowledgeExample
  classification_results: ClassificationResult
  notifications: NotificationRecord
  artifacts: Artifact
  audit_logs: AuditLog
  app_settings: AppSettings
}
export type CollectionName = keyof Collections

export const UNIQUE_KEYS: { [K in CollectionName]: keyof Collections[K] & string } = {
  agencies: 'agencyId',
  remedy_tickets: 'ticketId',
  workflow_definitions: 'workflowId',
  workflow_instances: 'instanceId',
  workflow_events: 'eventId',
  human_tasks: 'taskId',
  kafka_messages: 'eventId',
  workflow_classification_knowledge: 'exampleId',
  classification_results: 'classificationId',
  notifications: 'notificationId',
  artifacts: 'artifactId',
  audit_logs: 'eventId',
  app_settings: 'key',
}

export const PublishEventSchema = z.object({
  scenarioId: z.string().optional(),
  topic: TopicSchema.default('remedy.ticket.created'),
  agencyId: z.string().min(2).max(20),
  ticketId: z.string().regex(/^INC[0-9]{6,12}$/, 'Formato Ticket ID: INC seguito da 6-12 cifre').optional(),
  operatorName: z.string().min(2).max(80),
  priority: PrioritySchema,
  subject: z.string().min(3).max(200),
  description: z.string().min(5).max(2000),
  eventId: z.string().min(8).max(80).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type PublishEventInput = z.infer<typeof PublishEventSchema>

export const RemedyTicketPayloadSchema = z.object({
  subject: z.string().min(3).max(200),
  description: z.string().min(5).max(2000),
  priority: PrioritySchema,
  category: z.string().optional(),
  requestedBy: z.string().min(2),
})
