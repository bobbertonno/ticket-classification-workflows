'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AgencyFilter, EmptyState, ErrorState, FilterSelect, LoadingBlock, Mono, PageHeader, Pill, StatusBadge } from '@/components/console/kit'
import { fetcher, qs } from '@/lib/client/api'
import { fmtDateTime, fmtDuration, MODE_LABELS } from '@/lib/client/format'
import type { WorkflowInstance } from '@/lib/domain/schemas'

type ExecutionRow = Omit<WorkflowInstance, 'context' | 'steps'> & {
  steps: Pick<WorkflowInstance['steps'][number], 'stepId' | 'type' | 'label' | 'status' | 'attempts'>[]
}

const STATUSES = ['PENDING', 'RUNNING', 'WAITING_FOR_HUMAN', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED']
const ACTIVE = new Set(['PENDING', 'RUNNING', 'WAITING_FOR_HUMAN', 'RETRYING'])

function slaState(e: ExecutionRow): { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' } {
  const end = e.completedAt ? new Date(e.completedAt).getTime() : Date.now()
  const elapsedMin = (end - new Date(e.createdAt).getTime()) / 60_000
  const ratio = elapsedMin / e.slaMinutes
  if (ratio > 1) return { label: 'SLA violato', tone: 'error' }
  if (!e.completedAt && ratio > 0.75) return { label: 'A rischio', tone: 'warning' }
  return { label: e.completedAt ? 'Entro SLA' : 'In linea', tone: e.completedAt ? 'success' : 'neutral' }
}

export function ExecutionsPage() {
  const [agencyId, setAgencyId] = useState('all')
  const [status, setStatus] = useState('all')
  const [mode, setMode] = useState('all')
  const { data, error, isLoading, mutate } = useSWR<{ executions: ExecutionRow[] }>(`/api/executions${qs({ agencyId, status, mode })}`, fetcher, {
    refreshInterval: 1500,
    keepPreviousData: true,
  })
  const executions = data?.executions ?? []
  const active = executions.filter((e) => ACTIVE.has(e.status)).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live Executions"
        description="Istanze di workflow persistite. Lo stato avanza tramite tick server-side dell'engine di simulazione."
        actions={
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            {active} attive · aggiornamento automatico
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <AgencyFilter value={agencyId} onChange={setAgencyId} />
        <FilterSelect label="Stato" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Tutti gli stati' }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect
          label="Modalità"
          value={mode}
          onChange={setMode}
          options={[{ value: 'all', label: 'Tutte le modalità' }, ...Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock rows={8} />
      ) : executions.length === 0 ? (
        <EmptyState icon={Activity} title="Nessuna esecuzione" description="Avvia uno scenario dalla Demo Control Bar o pubblica un evento dal Kafka Simulator." />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Istanza</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Agenzia</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="min-w-52">Step corrente</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Avvio</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Modalità</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((e) => {
                  const done = e.steps.filter((s) => s.status === 'COMPLETED' || s.status === 'SKIPPED').length
                  const current = e.steps[e.currentStepIndex]
                  const sla = slaState(e)
                  return (
                    <TableRow key={e.instanceId}>
                      <TableCell>
                        <Link href={`/executions/${e.instanceId}`} className="font-mono text-xs font-medium text-primary hover:underline">
                          {e.instanceId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/tickets/${e.ticketId}`} className="font-mono text-xs hover:underline">
                          {e.ticketId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Mono>{e.agencyId}</Mono>
                      </TableCell>
                      <TableCell className="text-sm">{e.workflowName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="truncate text-xs">{e.status === 'COMPLETED' ? 'Completato' : (current?.label ?? '—')}</span>
                          <Progress value={(done / Math.max(1, e.steps.length)) * 100} className="h-1" aria-label={`${done} di ${e.steps.length} step`} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
                      <TableCell className="text-xs tabular-nums">{fmtDuration(e.createdAt, e.completedAt)}</TableCell>
                      <TableCell>
                        <Pill tone={sla.tone}>{sla.label}</Pill>
                      </TableCell>
                      <TableCell className="text-xs">{MODE_LABELS[e.executionMode] ?? e.executionMode}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
