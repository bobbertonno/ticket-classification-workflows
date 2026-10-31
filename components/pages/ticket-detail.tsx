'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArtifactList, type ArtifactWithLink } from '@/components/console/artifact-list'
import { EmptyState, ErrorState, Field, LoadingBlock, Mono, PageHeader, Pill, StatusBadge } from '@/components/console/kit'
import { WorkflowDiagram } from '@/components/console/workflow-diagram'
import { priorityTone } from '@/components/pages/tickets'
import { fetcher } from '@/lib/client/api'
import { fmtDateTime, METHOD_LABELS, PRIORITY_LABELS } from '@/lib/client/format'
import { CATEGORY_LABELS } from '@/lib/domain/seed-data'
import type { Agency, ClassificationResult, HumanTask, KafkaMessage, NotificationRecord, RemedyTicket, WorkflowInstance } from '@/lib/domain/schemas'

interface TicketDetailData {
  ticket: RemedyTicket
  agency: Agency | null
  classification: ClassificationResult | null
  instances: WorkflowInstance[]
  artifacts: ArtifactWithLink[]
  notifications: NotificationRecord[]
  messages: KafkaMessage[]
  tasks: HumanTask[]
}

export function TicketDetailPage({ ticketId }: { ticketId: string }) {
  const { data, error, isLoading, mutate } = useSWR<TicketDetailData>(`/api/tickets/${encodeURIComponent(ticketId)}`, fetcher, { refreshInterval: 2500 })
  const { data: art } = useSWR<{ artifacts: ArtifactWithLink[] }>(`/api/artifacts?ticketId=${encodeURIComponent(ticketId)}`, fetcher, { refreshInterval: 5000 })

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (isLoading || !data) return <LoadingBlock rows={10} />
  const { ticket, agency, classification, instances, notifications, messages, tasks } = data
  const instance = instances[0]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/tickets" />}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Remedy Tickets
        </Button>
      </div>
      <PageHeader
        title={ticket.subject}
        description={`${ticket.ticketId} · aperto da ${ticket.operatorName} (${ticket.agencyId} — ${ticket.agencyName})`}
        actions={
          <>
            <Pill tone={priorityTone(ticket.priority)}>Priorità {PRIORITY_LABELS[ticket.priority]}</Pill>
            <StatusBadge status={ticket.status} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Informazioni ticket</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{ticket.description}</p>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Categoria">{ticket.category ? CATEGORY_LABELS[ticket.category] : 'In classificazione'}</Field>
              <Field label="Workflow assegnato">{ticket.workflowId ? <Mono>{ticket.workflowId}</Mono> : '—'}</Field>
              <Field label="Notifica">
                <StatusBadge status={ticket.notificationStatus} />
              </Field>
              <Field label="Creato">{fmtDateTime(ticket.createdAt)}</Field>
              <Field label="Ultimo aggiornamento">{fmtDateTime(ticket.updatedAt)}</Field>
              <Field label="Correlation ID">
                <Mono className="break-all">{ticket.correlationId}</Mono>
              </Field>
            </dl>
            {ticket.resolution && (
              <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
                <span className="font-medium text-success">Risoluzione: </span>
                {ticket.resolution}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agenzia di origine</CardTitle>
          </CardHeader>
          <CardContent>
            {agency ? (
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Codice">
                  <Mono>{agency.agencyId}</Mono>
                </Field>
                <Field label="Nome">{agency.agencyName}</Field>
                <Field label="Città">{agency.city}</Field>
                <Field label="Regione">{agency.region}</Field>
                <Field label="Area">{agency.geographicArea}</Field>
                <Field label="Referente">{agency.operatorName}</Field>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Agenzia non trovata</p>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground">Metadati autoritativi dall&apos;evento Kafka — non dedotti dal testo del ticket.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Esecuzione workflow</CardTitle>
          {instance && (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/executions/${instance.instanceId}`} />}>
              Dettaglio esecuzione
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {instance ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{instance.workflowName}</span>
                <Mono className="text-muted-foreground">{instance.instanceId}</Mono>
                <StatusBadge status={instance.status} />
              </div>
              <WorkflowDiagram steps={instance.steps} currentIndex={instance.currentStepIndex} height={260} />
            </>
          ) : (
            <EmptyState title="Nessuna esecuzione associata" />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">Classificazione</CardTitle>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/classification?ticket=${ticket.ticketId}`} />}>
              Insights
            </Button>
          </CardHeader>
          <CardContent>
            {classification ? (
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Categoria selezionata">{CATEGORY_LABELS[classification.selectedCategory]}</Field>
                <Field label="Workflow">
                  <Mono>{classification.selectedWorkflow}</Mono>
                </Field>
                <Field label="Metodo">
                  {METHOD_LABELS[classification.method] ?? classification.method} {classification.simulated && <Pill tone="warning">simulato</Pill>}
                </Field>
                <Field label="Modello">{classification.modelName}</Field>
                <Field label="Miglior similarità">{classification.semanticMatches[0]?.score.toFixed(3) ?? '—'}</Field>
                <Field label="Revisione umana">{classification.humanReviewRequired ? 'Richiesta' : 'Non richiesta'}</Field>
              </dl>
            ) : (
              <EmptyState title="Classificazione non ancora disponibile" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 border-l pl-4">
              {[...ticket.timeline].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`} className="relative flex flex-col gap-0.5">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                  <div className="flex items-center gap-2">
                    <StatusBadge status={e.status} />
                    <span className="text-xs text-muted-foreground">{fmtDateTime(e.at)}</span>
                  </div>
                  <span className="text-sm">{e.note}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Documenti generati</CardTitle>
          </CardHeader>
          <CardContent>
            <ArtifactList artifacts={art?.artifacts ?? data.artifacts} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Notifiche</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {notifications.length === 0 ? (
              <EmptyState icon={Mail} title="Nessuna notifica inviata" />
            ) : (
              notifications.map((n) => (
                <div key={n.notificationId} className="flex flex-col gap-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{n.subject}</span>
                    <StatusBadge status={n.deliveryStatus} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {n.channel} → {n.recipient} · {fmtDateTime(n.timestamp)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Human Tasks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna approvazione richiesta.</p>
            ) : (
              tasks.map((t) => (
                <Link key={t.taskId} href={`/tasks?task=${t.taskId}`} className="flex items-center justify-between gap-2 rounded-md border p-3 hover:bg-muted/50">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{t.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.assignedTeam}
                      {t.decision ? ` · ${t.decision.approver}: ${t.decision.decision}` : ''}
                    </span>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Messaggi Kafka correlati</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun messaggio.</p>
            ) : (
              messages.map((m) => (
                <div key={m.eventId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <Mono className="text-primary">{m.topic}</Mono>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(m.timestamp)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
