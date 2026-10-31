'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { ArrowLeft, Ban, Play, RotateCcw, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArtifactList, type ArtifactWithLink } from '@/components/console/artifact-list'
import { EmptyState, ErrorState, Field, JsonBlock, LoadingBlock, Mono, PageHeader, Spinner, StatusBadge } from '@/components/console/kit'
import { useSession } from '@/components/console/session-provider'
import { WorkflowDiagram } from '@/components/console/workflow-diagram'
import { apiSend, fetcher, refreshAll } from '@/lib/client/api'
import { fmtDateTime, fmtDuration, fmtTime, MODE_LABELS } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import type { HumanTask, KafkaMessage, NotificationRecord, RemedyTicket, WorkflowDefinition, WorkflowEvent, WorkflowInstance } from '@/lib/domain/schemas'

interface ExecutionDetailData {
  instance: WorkflowInstance
  definition: WorkflowDefinition | null
  ticket: RemedyTicket | null
  events: WorkflowEvent[]
  tasks: HumanTask[]
  artifacts: ArtifactWithLink[]
  notifications: NotificationRecord[]
  messages: KafkaMessage[]
}

export function ExecutionDetailPage({ instanceId }: { instanceId: string }) {
  const { can } = useSession()
  const key = `/api/executions/${encodeURIComponent(instanceId)}`
  const { data, error, isLoading, mutate } = useSWR<ExecutionDetailData>(key, fetcher, { refreshInterval: 1500 })
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (isLoading || !data) return <LoadingBlock rows={10} />
  const { instance, events, tasks, notifications, messages } = data
  const status = instance.status
  const canRetry = status === 'FAILED'
  const canResume = status === 'PENDING' || status === 'RETRYING'
  const canCancel = !['COMPLETED', 'CANCELLED'].includes(status)
  const step = instance.steps.find((s) => s.stepId === selectedStep) ?? instance.steps[instance.currentStepIndex] ?? instance.steps[0]

  async function act(action: 'retry' | 'resume' | 'cancel') {
    setBusy(action)
    try {
      await apiSend(`${key}/${action}`, action === 'cancel' ? { reason: 'Annullato dalla console' } : {})
      toast.success(action === 'retry' ? 'Retry avviato' : action === 'resume' ? 'Esecuzione ripresa' : 'Esecuzione annullata')
      await mutate()
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/executions" />}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Live Executions
        </Button>
      </div>
      <PageHeader
        title={instance.workflowName}
        description={`${instance.instanceId} · ${instance.agencyId} — ${instance.agencyName}`}
        actions={
          <>
            <StatusBadge status={status} />
            {can('approver') && (
              <>
                <Button size="sm" variant="outline" disabled={!canRetry || !!busy} onClick={() => act('retry')}>
                  {busy === 'retry' ? <Spinner /> : <RotateCcw className="size-3.5" aria-hidden />}
                  Retry
                </Button>
                <Button size="sm" variant="outline" disabled={!canResume || !!busy} onClick={() => act('resume')}>
                  {busy === 'resume' ? <Spinner /> : <Play className="size-3.5" aria-hidden />}
                  Resume
                </Button>
                <Button size="sm" variant="outline" disabled={!canCancel || !!busy} onClick={() => act('cancel')}>
                  {busy === 'cancel' ? <Spinner /> : <Ban className="size-3.5" aria-hidden />}
                  Annulla
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => setLogsOpen(true)}>
              <ScrollText className="size-3.5" aria-hidden />
              Log
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
          <Field label="Ticket">
            <Link href={`/tickets/${instance.ticketId}`} className="font-mono text-xs text-primary hover:underline">
              {instance.ticketId}
            </Link>
          </Field>
          <Field label="Workflow">
            <Mono>{instance.workflowId}</Mono>
          </Field>
          <Field label="Modalità">{MODE_LABELS[instance.executionMode]}</Field>
          <Field label="Avvio">{fmtDateTime(instance.createdAt)}</Field>
          <Field label="Durata">{fmtDuration(instance.createdAt, instance.completedAt)}</Field>
          <Field label="SLA">{instance.slaMinutes} min</Field>
          <Field label="Retry policy">
            {instance.retryPolicy.maxAttempts} tentativi · backoff {instance.retryPolicy.backoffMs} ms
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Diagramma di esecuzione</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowDiagram steps={instance.steps} currentIndex={instance.currentStepIndex} height={320} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Step</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1">
              {instance.steps.map((s, i) => (
                <li key={s.stepId}>
                  <button
                    type="button"
                    onClick={() => setSelectedStep(s.stepId)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left hover:bg-muted/50',
                      step?.stepId === s.stepId && 'border-primary bg-accent/50',
                    )}
                    aria-pressed={step?.stepId === s.stepId}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="truncate text-sm">{s.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {s.attempts > 1 && <span className="text-[10px] text-muted-foreground">{s.attempts}x</span>}
                      <StatusBadge status={s.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm">{step ? `Step: ${step.label}` : 'Step'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {step && (
              <>
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label="Tipo">
                    <Mono>{step.type}</Mono>
                  </Field>
                  <Field label="Tentativi">{step.attempts}</Field>
                  <Field label="Inizio">{fmtTime(step.startedAt)}</Field>
                  <Field label="Fine">{fmtTime(step.completedAt)}</Field>
                </dl>
                {step.error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{step.error}</div>}
                <Tabs defaultValue="output">
                  <TabsList>
                    <TabsTrigger value="input">Input</TabsTrigger>
                    <TabsTrigger value="output">Output</TabsTrigger>
                  </TabsList>
                  <TabsContent value="input">
                    {step.input ? <JsonBlock value={step.input} /> : <p className="py-2 text-sm text-muted-foreground">Nessun input registrato.</p>}
                  </TabsContent>
                  <TabsContent value="output">
                    {step.output ? <JsonBlock value={step.output} /> : <p className="py-2 text-sm text-muted-foreground">Nessun output ancora.</p>}
                  </TabsContent>
                </Tabs>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Timeline esecuzione</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex max-h-96 flex-col gap-2 overflow-auto">
              {events.map((e) => (
                <li key={e.eventId} className="flex gap-3 text-sm">
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{fmtTime(e.timestamp)}</span>
                  <span className="flex min-w-0 flex-col">
                    <Mono className={cn('text-[11px]', e.type.includes('FAIL') || e.type.includes('ERROR') ? 'text-destructive' : 'text-primary')}>{e.type}</Mono>
                    <span>{e.message}</span>
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Decisioni umane</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessun task Human-in-the-Loop.</p>
              ) : (
                tasks.map((t) => (
                  <Link key={t.taskId} href={`/tasks?task=${t.taskId}`} className="flex flex-col gap-1 rounded-md border p-3 hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t.title}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    {t.decision && (
                      <span className="text-xs text-muted-foreground">
                        {t.decision.decision} da {t.decision.approver} · {fmtDateTime(t.decision.timestamp)}
                        {t.decision.comment ? ` — “${t.decision.comment}”` : ''}
                      </span>
                    )}
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Artefatti</CardTitle>
            </CardHeader>
            <CardContent>
              <ArtifactList artifacts={data.artifacts} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Messaggi Kafka correlati</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {messages.map((m) => (
              <div key={m.eventId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <Mono className="text-primary">{m.topic}</Mono>
                <span className="text-xs text-muted-foreground">{fmtTime(m.timestamp)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Notifiche outbound</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {notifications.length === 0 ? (
              <EmptyState title="Nessuna notifica" />
            ) : (
              notifications.map((n) => (
                <div key={n.notificationId} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{n.subject}</span>
                    <span className="text-xs text-muted-foreground">
                      {n.channel} → {n.recipient}
                    </span>
                  </div>
                  <StatusBadge status={n.deliveryStatus} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Log strutturati</SheetTitle>
            <SheetDescription>Eventi workflow persistiti per {instance.instanceId} (formato compatibile OpenTelemetry).</SheetDescription>
          </SheetHeader>
          <div className="overflow-auto px-4 pb-4">
            <JsonBlock
              className="max-h-none"
              value={events.map((e) => ({
                timestamp: e.timestamp,
                severity: e.type.includes('FAIL') ? 'ERROR' : 'INFO',
                body: e.message,
                attributes: { 'workflow.instance_id': e.instanceId, 'workflow.step_id': e.stepId, 'event.type': e.type, correlation_id: e.correlationId, ...(e.data ?? {}) },
              }))}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
