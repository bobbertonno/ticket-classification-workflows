'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { Activity, AlertOctagon, CheckCircle2, Clock, Gauge, Hourglass, Layers, ShieldCheck, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Donut, ExecutionsOverTime, HorizontalBars } from '@/components/console/charts'
import { AgencyFilter, EmptyState, ErrorState, FilterSelect, KpiCard, LoadingBlock, Mono, PageHeader, Pill, StatusBadge } from '@/components/console/kit'
import { fetcher, qs } from '@/lib/client/api'
import { fmtDateTime, fmtMinutes, fmtNum, fmtPct, fmtTime, PRIORITY_LABELS } from '@/lib/client/format'
import type { HumanTask, WorkflowDefinition } from '@/lib/domain/schemas'

interface DashboardData {
  kpis: { total: number; completed: number; running: number; waiting: number; failed: number; pendingTasks: number; successRate: number | null; avgResolutionMin: number | null; slaCompliance: number | null; stpRate: number | null }
  timeline: { date: string; completed: number; failed: number; inProgress: number; total: number }[]
  byCategory: { category: string; label: string; count: number }[]
  modeSplit: { mode: string; count: number }[]
  recent: { instanceId: string; ticketId: string; agencyId: string; agencyName: string; workflowName: string; status: string; currentStep: string; createdAt: string; seeded: boolean }[]
  recentErrors: { instanceId: string; ticketId: string; agencyId: string; workflowName: string; status: string; step: string; error: string; at: string }[]
  pendingApprovals: HumanTask[]
  topAgencies: { agencyId: string; agencyName: string; count: number }[]
  dataSource: { seededCount: number; liveCount: number }
}

const STATUS_OPTS = [
  { value: 'all', label: 'Tutti gli stati' },
  ...['RUNNING', 'WAITING_FOR_HUMAN', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'PENDING'].map((s) => ({ value: s, label: s })),
]
const MODE_OPTS = [
  { value: 'all', label: 'Tutte le modalità' },
  { value: 'AUTOMATED', label: 'Fully Automated' },
  { value: 'HITL', label: 'Human-in-the-Loop' },
  { value: 'MANUAL_TRIAGE', label: 'Manual Triage' },
]

export function OverviewDashboard() {
  const [agencyId, setAgency] = useState('all')
  const [workflowId, setWorkflow] = useState('all')
  const [status, setStatus] = useState('all')
  const [mode, setMode] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: wf } = useSWR<{ workflows: WorkflowDefinition[] }>('/api/workflows', fetcher)
  const { data, error, isLoading, mutate } = useSWR<DashboardData>(
    `/api/dashboard${qs({ agencyId, workflowId, status, mode, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined })}`,
    fetcher,
    { refreshInterval: 3000, keepPreviousData: true },
  )

  const wfOpts = [{ value: 'all', label: 'Tutti i workflow' }, ...(wf?.workflows ?? []).map((w) => ({ value: w.workflowId, label: w.name }))]

  return (
    <>
      <PageHeader
        title="Overview operativa"
        description="Monitoraggio centralizzato di workflow automatici e Human-in-the-Loop originati da ticket BMC Remedy. Aggiornamento automatico ogni 3 secondi."
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtri">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Dal
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36 bg-card" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Al
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-36 bg-card" />
        </label>
        <AgencyFilter value={agencyId} onChange={setAgency} />
        <FilterSelect label="Workflow" value={workflowId} onChange={setWorkflow} options={wfOpts} className="min-w-56" />
        <FilterSelect label="Stato" value={status} onChange={setStatus} options={STATUS_OPTS} />
        <FilterSelect label="Modalità" value={mode} onChange={setMode} options={MODE_OPTS} />
      </div>

      {error && <ErrorState error={error} onRetry={() => mutate()} />}
      {isLoading && !data && <LoadingBlock rows={8} />}

      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            Fonte dati: {fmtNum(data.dataSource.liveCount)} esecuzioni generate in questa sessione demo · {fmtNum(data.dataSource.seededCount)} esecuzioni storiche sintetiche del dataset di inizializzazione. Nessuna metrica proviene da sistemi di produzione.
          </p>

          <section aria-label="KPI" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Esecuzioni totali" value={fmtNum(data.kpis.total)} icon={Layers} tone="brand" />
            <KpiCard label="Completate" value={fmtNum(data.kpis.completed)} icon={CheckCircle2} tone="success" />
            <KpiCard label="In esecuzione" value={fmtNum(data.kpis.running)} hint={`${data.kpis.waiting} in attesa umana`} icon={Activity} tone="info" />
            <KpiCard label="Fallite" value={fmtNum(data.kpis.failed)} icon={AlertOctagon} tone="error" />
            <KpiCard label="Human Tasks in attesa" value={fmtNum(data.kpis.pendingTasks)} icon={Hourglass} tone="warning" />
            <KpiCard label="Automation Success Rate" value={fmtPct(data.kpis.successRate)} hint="Completate / concluse" icon={Gauge} tone="success" />
            <KpiCard label="Tempo medio risoluzione" value={fmtMinutes(data.kpis.avgResolutionMin)} icon={Clock} tone="info" />
            <KpiCard label="SLA Compliance" value={fmtPct(data.kpis.slaCompliance)} hint="Completate entro SLA" icon={ShieldCheck} tone="success" />
            <KpiCard label="Straight-Through Processing" value={fmtPct(data.kpis.stpRate)} hint="Senza intervento umano" icon={Zap} tone="brand" />
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm">Esecuzioni nel tempo</CardTitle>
                <CardDescription>Ultimi 14 giorni · completati vs falliti vs in corso</CardDescription>
              </CardHeader>
              <CardContent>
                <ExecutionsOverTime data={data.timeline} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Automatico vs HITL</CardTitle>
                <CardDescription>Esecuzioni con o senza decisione umana</CardDescription>
              </CardHeader>
              <CardContent>
                <Donut data={data.modeSplit} nameKey="mode" dataKey="count" />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Volume per categoria workflow</CardTitle>
              </CardHeader>
              <CardContent>
                {data.byCategory.length ? <HorizontalBars data={data.byCategory} dataKey="count" labelKey="label" name="Esecuzioni" /> : <EmptyState title="Nessuna esecuzione per i filtri selezionati" />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Top agenzie per volume</CardTitle>
              </CardHeader>
              <CardContent>
                {data.topAgencies.length ? (
                  <HorizontalBars data={data.topAgencies.map((a) => ({ ...a, label: `${a.agencyId} ${a.agencyName}` }))} dataKey="count" labelKey="label" name="Ticket" color="#252525" />
                ) : (
                  <EmptyState title="Nessun dato" />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Esecuzioni recenti</CardTitle>
              <Link href="/executions" className="text-xs font-medium text-primary hover:underline">
                Vedi tutte
              </Link>
            </CardHeader>
            <CardContent>
              {data.recent.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Istanza</TableHead>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Agenzia</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Step corrente</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead className="text-right">Avvio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent.map((r) => (
                      <TableRow key={r.instanceId}>
                        <TableCell>
                          <Link href={`/executions/${r.instanceId}`} className="font-mono text-xs text-primary hover:underline">
                            {r.instanceId}
                          </Link>
                          {r.seeded && <Pill className="ml-2">storico</Pill>}
                        </TableCell>
                        <TableCell>
                          <Link href={`/tickets/${r.ticketId}`} className="font-mono text-xs hover:underline">
                            {r.ticketId}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.agencyId} — {r.agencyName}
                        </TableCell>
                        <TableCell className="text-xs">{r.workflowName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.currentStep}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtDateTime(r.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="Nessuna esecuzione" description="Pubblica un evento dal Kafka Simulator o avvia uno scenario dalla Demo Control Bar." />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Errori recenti</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.recentErrors.length ? (
                  data.recentErrors.map((e) => (
                    <Link key={e.instanceId} href={`/executions/${e.instanceId}`} className="flex flex-col gap-1 rounded-md border border-destructive/20 bg-destructive/5 p-3 hover:bg-destructive/10">
                      <div className="flex items-center justify-between gap-2">
                        <Mono>{e.instanceId}</Mono>
                        <StatusBadge status={e.status} />
                      </div>
                      <p className="text-xs">
                        {e.workflowName} · {e.agencyId} · step «{e.step}»
                      </p>
                      <p className="line-clamp-2 font-mono text-[11px] text-destructive">{e.error}</p>
                    </Link>
                  ))
                ) : (
                  <EmptyState title="Nessun errore" description="Tutti i workflow sono in stato regolare." icon={CheckCircle2} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Approvazioni in attesa</CardTitle>
                <Link href="/tasks" className="text-xs font-medium text-primary hover:underline">
                  Apri Inbox
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.pendingApprovals.length ? (
                  data.pendingApprovals.map((t) => (
                    <Link key={t.taskId} href={`/tasks?task=${t.taskId}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/50">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{t.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.agencyId} — {t.agencyName} · {t.ticketId} · scade {fmtTime(t.dueAt)}
                        </span>
                      </div>
                      <Pill tone={t.priority === 'HIGH' || t.priority === 'CRITICAL' ? 'error' : 'neutral'}>{PRIORITY_LABELS[t.priority]}</Pill>
                    </Link>
                  ))
                ) : (
                  <EmptyState title="Nessuna approvazione in attesa" icon={CheckCircle2} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  )
}
