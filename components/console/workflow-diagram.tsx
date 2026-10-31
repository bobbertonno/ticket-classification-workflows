'use client'

import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Bell,
  BrainCircuit,
  CheckCheck,
  FileSpreadsheet,
  GitBranch,
  Radio,
  Server,
  Ticket,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/client/format'

export interface DiagramStep {
  stepId: string
  type: string
  label: string
  status?: string
  attempts?: number
}

const ICONS: Record<string, LucideIcon> = {
  kafka_trigger: Radio,
  classification: BrainCircuit,
  condition: GitBranch,
  api_call: Server,
  document_generation: FileSpreadsheet,
  human_approval: UserCheck,
  notification: Bell,
  remedy_update: Ticket,
  completion: CheckCheck,
  error_handler: AlertTriangle,
}

const TYPE_LABELS: Record<string, string> = {
  kafka_trigger: 'Kafka Trigger',
  classification: 'Classification',
  condition: 'Condition',
  api_call: 'API Call',
  document_generation: 'Document Generation',
  human_approval: 'Human Approval',
  notification: 'Notification',
  remedy_update: 'Remedy Update',
  completion: 'Completion',
  error_handler: 'Error Handler',
}

type StepNodeData = DiagramStep & { active: boolean } & Record<string, unknown>

const statusStyles: Record<string, string> = {
  COMPLETED: 'border-success/60 bg-success/5',
  RUNNING: 'border-info ring-2 ring-info/25 bg-info/5',
  WAITING: 'border-warning ring-2 ring-warning/25 bg-warning/8',
  FAILED: 'border-destructive ring-2 ring-destructive/20 bg-destructive/5',
  SKIPPED: 'border-dashed opacity-60',
}

const dotStyles: Record<string, string> = {
  COMPLETED: 'bg-success',
  RUNNING: 'bg-info animate-pulse',
  WAITING: 'bg-warning animate-pulse',
  FAILED: 'bg-destructive',
  SKIPPED: 'bg-muted-foreground/40',
  PENDING: 'bg-border',
}

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const Icon = ICONS[data.type] ?? Server
  const st = data.status ?? 'PENDING'
  return (
    <div className={cn('w-52 rounded-lg border bg-card px-3 py-2.5 shadow-sm', statusStyles[st], data.active && st === 'PENDING' && 'border-primary')}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-border" />
      <div className="flex items-start gap-2">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', data.type === 'error_handler' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary')}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{TYPE_LABELS[data.type] ?? data.type}</span>
          <span className="text-xs font-medium leading-snug text-foreground">{data.label}</span>
          {data.status && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={cn('size-1.5 rounded-full', dotStyles[st])} aria-hidden />
              {STATUS_LABELS[st] ?? st}
              {data.attempts && data.attempts > 1 ? ` · ${data.attempts} tentativi` : ''}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-border" />
    </div>
  )
}

const nodeTypes = { step: StepNode }

export function WorkflowDiagram({ steps, currentIndex, height = 300 }: { steps: DiagramStep[]; currentIndex?: number; height?: number }) {
  const { nodes, edges } = useMemo(() => {
    const main = steps.filter((s) => s.type !== 'error_handler')
    const handlers = steps.filter((s) => s.type === 'error_handler')
    const perRow = 4
    const nodes: Node<StepNodeData>[] = main.map((s, i) => {
      const row = Math.floor(i / perRow)
      const col = row % 2 === 0 ? i % perRow : perRow - 1 - (i % perRow)
      return {
        id: s.stepId,
        type: 'step',
        position: { x: col * 250, y: row * 120 },
        data: { ...s, active: steps.indexOf(s) === currentIndex },
        draggable: false,
      }
    })
    const rows = Math.ceil(main.length / perRow)
    handlers.forEach((s, i) => {
      nodes.push({ id: s.stepId, type: 'step', position: { x: i * 250 + 125, y: rows * 120 + 10 }, data: { ...s, active: steps.indexOf(s) === currentIndex }, draggable: false })
    })
    const edges: Edge[] = main.slice(1).map((s, i) => {
      const prev = main[i]
      const done = prev.status === 'COMPLETED' || prev.status === 'SKIPPED'
      return {
        id: `${prev.stepId}-${s.stepId}`,
        source: prev.stepId,
        target: s.stepId,
        type: 'smoothstep',
        animated: s.status === 'RUNNING' || s.status === 'WAITING',
        style: { stroke: done ? '#16803C' : '#C9CDD4', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: done ? '#16803C' : '#C9CDD4' },
      }
    })
    for (const h of handlers) {
      const failed = main.find((s) => s.status === 'FAILED') ?? main.find((s) => s.type === 'document_generation') ?? main[Math.floor(main.length / 2)]
      if (failed)
        edges.push({
          id: `${failed.stepId}-${h.stepId}`,
          source: failed.stepId,
          target: h.stepId,
          type: 'smoothstep',
          style: { stroke: '#D92D20', strokeDasharray: '4 4', strokeWidth: 1.25 },
          label: 'on error',
          labelStyle: { fontSize: 10, fill: '#D92D20' },
        })
    }
    return { nodes, edges }
  }, [steps, currentIndex])

  return (
    <div style={{ height }} className="w-full overflow-hidden rounded-lg border bg-[#FBFBFC]" role="img" aria-label={`Diagramma workflow: ${steps.map((s) => s.label).join(', ')}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background gap={18} size={1} color="#E5E7EB" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}
