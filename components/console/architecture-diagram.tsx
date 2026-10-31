'use client'

import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Bell, Cpu, FileSpreadsheet, Monitor, Radio, Server, Sparkles, Ticket, Workflow, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ATLAS_FEATURES, type FeatureId } from '@/components/pages/architecture-data'

type ServiceData = { label: string; caption: string; icon: LucideIcon; tone: 'neutral' | 'app' | 'external' } & Record<string, unknown>
type CapabilityData = { featureId: FeatureId; selected: boolean } & Record<string, unknown>
type GroupData = { title: string; caption: string } & Record<string, unknown>

const handles = (
  <>
    <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-border" />
    <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-border" />
  </>
)

function ServiceNode({ data }: NodeProps<Node<ServiceData>>) {
  const Icon = data.icon
  return (
    <div
      className={cn(
        'w-48 rounded-lg border bg-card px-3 py-2.5 shadow-sm',
        data.tone === 'app' && 'border-primary/40',
        data.tone === 'external' && 'border-info/40',
      )}
    >
      {handles}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            data.tone === 'app' ? 'bg-accent text-primary' : data.tone === 'external' ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-semibold leading-snug text-foreground">{data.label}</span>
          <span className="text-[10px] leading-snug text-muted-foreground">{data.caption}</span>
        </div>
      </div>
    </div>
  )
}

function CapabilityNode({ data }: NodeProps<Node<CapabilityData>>) {
  const f = ATLAS_FEATURES.find((x) => x.id === data.featureId)!
  const Icon = f.icon
  return (
    <div
      className={cn(
        'w-52 cursor-pointer rounded-md border bg-card px-2.5 py-2 transition-shadow hover:shadow-md',
        data.selected ? 'border-success ring-2 ring-success/25' : 'border-success/25',
      )}
    >
      {handles}
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-success" aria-hidden />
        <span className="truncate text-xs font-medium text-foreground">{f.title}</span>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{f.atlasCapability}</p>
    </div>
  )
}

function GroupNode({ data }: NodeProps<Node<GroupData>>) {
  return (
    <div className="size-full rounded-xl border-2 border-success/50 bg-success/[0.04]">
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-success" />
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-success" />
      <div className="flex items-baseline justify-between px-4 pt-3">
        <span className="text-sm font-semibold text-success">{data.title}</span>
        <span className="text-[10px] text-muted-foreground">{data.caption}</span>
      </div>
    </div>
  )
}

const nodeTypes = { service: ServiceNode, capability: CapabilityNode, atlas: GroupNode }

const GROUP_X = 560
const CAP_COLS: FeatureId[][] = [
  ['document-model', 'indexes', 'atomic-updates', 'event-log', 'audit'],
  ['vector-search', 'auto-embedding', 'search-index-mgmt', 'security', 'serverless-driver'],
]

function edge(source: string, target: string, opts: { label?: string; dashed?: boolean; color?: string; animated?: boolean } = {}): Edge {
  const color = opts.color ?? '#98A2B3'
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: opts.animated,
    label: opts.label,
    labelStyle: { fontSize: 10, fill: '#667085' },
    labelBgStyle: { fill: '#FBFBFC' },
    style: { stroke: color, strokeWidth: 1.5, strokeDasharray: opts.dashed ? '4 4' : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  }
}

export function ArchitectureDiagram({ selected, onSelect }: { selected: FeatureId | null; onSelect: (id: FeatureId) => void }) {
  const { nodes, edges } = useMemo(() => {
    const svc = (id: string, x: number, y: number, label: string, caption: string, icon: LucideIcon, tone: ServiceData['tone']): Node<ServiceData> => ({
      id,
      type: 'service',
      position: { x, y },
      data: { label, caption, icon, tone },
      draggable: false,
      selectable: false,
    })

    const nodes: Node[] = [
      svc('remedy', 0, 40, 'BMC Remedy', 'Ticket dalle agenzie', Ticket, 'neutral'),
      svc('kafka', 0, 190, 'Kafka topics', 'remedy.ticket.created, …', Radio, 'neutral'),
      svc('console', 0, 340, 'Control Center UI', 'Presenter e operatori', Monitor, 'neutral'),
      svc('api', 270, 40, 'API Routes', 'Next.js su Vercel', Server, 'app'),
      svc('engine', 270, 190, 'Workflow engine', 'Tick persistiti, HITL', Workflow, 'app'),
      svc('classifier', 270, 340, 'Classificatore', 'Pipeline semantica', Cpu, 'app'),
      svc('docs', 270, 490, 'Documenti e notifiche', 'XLSX, PDF, outbox', FileSpreadsheet, 'app'),
      {
        id: 'atlas',
        type: 'atlas',
        position: { x: GROUP_X, y: 0 },
        data: { title: 'MongoDB Atlas', caption: 'unico componente stateful' },
        style: { width: 500, height: 580 },
        draggable: false,
        selectable: false,
      },
      svc('voyage', GROUP_X + 580, 250, 'Voyage AI', 'Embedding e reranking', Sparkles, 'external'),
      svc('notify', GROUP_X + 580, 470, 'Canali in uscita', 'Email, Remedy (simulati)', Bell, 'neutral'),
    ]

    CAP_COLS.forEach((col, c) =>
      col.forEach((featureId, r) =>
        nodes.push({
          id: featureId,
          type: 'capability',
          parentId: 'atlas',
          extent: 'parent',
          position: { x: 22 + c * 240, y: 50 + r * 104 },
          data: { featureId, selected: selected === featureId },
          draggable: false,
        }),
      ),
    )

    const green = '#16803C'
    const edges: Edge[] = [
      edge('remedy', 'kafka', { label: 'evento' }),
      edge('kafka', 'api', { animated: true }),
      edge('console', 'api'),
      edge('api', 'engine'),
      edge('engine', 'classifier'),
      edge('engine', 'docs'),
      edge('api', 'indexes', { color: green, label: 'eventId unique' }),
      edge('engine', 'atomic-updates', { color: green, animated: true }),
      edge('engine', 'event-log', { color: green }),
      edge('classifier', 'vector-search', { color: green, animated: true }),
      edge('docs', 'audit', { color: green }),
      edge('auto-embedding', 'voyage', { color: '#2563EB', label: 'Atlas → Voyage', dashed: true }),
      edge('classifier', 'voyage', { color: '#2563EB', label: 'API esterna' }),
      edge('event-log', 'notify', { label: 'outbox' }),
    ]
    return { nodes, edges }
  }, [selected])

  return (
    <div
      className="h-[560px] w-full overflow-hidden rounded-lg border bg-[#FBFBFC]"
      role="img"
      aria-label="Diagramma architetturale: BMC Remedy e Kafka alimentano le API Next.js su Vercel; workflow engine, classificatore e generazione documenti persistono tutto su MongoDB Atlas, che usa Voyage AI per gli embedding."
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => {
          if (n.type === 'capability') onSelect(n.id as FeatureId)
        }}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        nodesConnectable={false}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.6}
      >
        <Background gap={18} size={1} color="#E5E7EB" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}
