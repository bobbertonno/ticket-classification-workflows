'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { History, Mail, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgencyFilter, EmptyState, ErrorState, FilterSelect, LoadingBlock, Mono, PageHeader, Pill, StatusBadge } from '@/components/console/kit'
import { fetcher, qs } from '@/lib/client/api'
import { fmtDateTime } from '@/lib/client/format'
import type { AuditLog, NotificationRecord } from '@/lib/domain/schemas'

const EVENT_TYPES: AuditLog['eventType'][] = ['KAFKA', 'TICKET', 'WORKFLOW', 'HUMAN_TASK', 'CLASSIFICATION', 'NOTIFICATION', 'ARTIFACT', 'SETTINGS', 'DEMO']
const outcomeTone = (o: AuditLog['outcome']) => (o === 'SUCCESS' ? 'success' : o === 'FAILURE' ? 'error' : 'info') as 'success' | 'error' | 'info'

export function AuditPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit & Analytics" description="Traccia di audit cronologica e log delle notifiche outbound simulate. Nessun segreto o credenziale viene mai registrato." />
      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">
            <History className="size-3.5" aria-hidden />
            Audit trail
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Mail className="size-3.5" aria-hidden />
            Notifiche outbound
          </TabsTrigger>
        </TabsList>
        <TabsContent value="audit" className="mt-4">
          <AuditTrail />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <NotificationLog />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AuditTrail() {
  const [agencyId, setAgencyId] = useState('all')
  const [eventType, setEventType] = useState('all')
  const [ticketId, setTicketId] = useState('')
  const [workflowId, setWorkflowId] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const key = `/api/audit${qs({ agencyId, eventType, ticketId: ticketId.trim() || undefined, workflowId: workflowId.trim() || undefined, actor: actor.trim() || undefined, from: from || undefined, to: to || undefined })}`
  const { data, error, isLoading, mutate } = useSWR<AuditLog[] | { logs: AuditLog[] }>(key, fetcher, { refreshInterval: 3000, keepPreviousData: true })
  const logs = Array.isArray(data) ? data : (data?.logs ?? [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <AgencyFilter value={agencyId} onChange={setAgencyId} />
        <FilterSelect label="Tipo evento" value={eventType} onChange={setEventType} options={[{ value: 'all', label: 'Tutti i tipi' }, ...EVENT_TYPES.map((t) => ({ value: t, label: t }))]} />
        <Input value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="Ticket ID" className="h-9 w-36 bg-card" aria-label="Filtra per ticket" />
        <Input value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} placeholder="Workflow ID" className="h-9 w-36 bg-card" aria-label="Filtra per workflow" />
        <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Attore" className="h-9 w-32 bg-card" aria-label="Filtra per attore" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 bg-card" aria-label="Dal" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 bg-card" aria-label="Al" />
        <span className="ml-auto text-xs text-muted-foreground">{logs.length} eventi</span>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock rows={8} />
      ) : logs.length === 0 ? (
        <EmptyState icon={History} title="Nessun evento di audit" description="Modifica i filtri o esegui uno scenario." />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Attore</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Azione</TableHead>
                  <TableHead>Agenzia</TableHead>
                  <TableHead>Ticket / Istanza</TableHead>
                  <TableHead>Transizione</TableHead>
                  <TableHead>Esito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.eventId}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{fmtDateTime(l.timestamp)}</TableCell>
                    <TableCell className="text-xs">
                      {l.actor}
                      {l.actorType === 'SYSTEM' && <span className="ml-1 text-[10px] text-muted-foreground">sistema</span>}
                    </TableCell>
                    <TableCell>
                      <Mono className="text-[11px]">{l.eventType}</Mono>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{l.action}</TableCell>
                    <TableCell>
                      <Mono>{l.agencyId ?? '—'}</Mono>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col">
                        {l.ticketId ? (
                          <Link href={`/tickets/${l.ticketId}`} className="font-mono text-primary hover:underline">
                            {l.ticketId}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {l.instanceId && (
                          <Link href={`/executions/${l.instanceId}`} className="font-mono text-[11px] text-muted-foreground hover:underline">
                            {l.instanceId}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 text-[11px] text-muted-foreground">
                      <span className="line-clamp-2 break-all">
                        {l.previousState || l.newState ? `${l.previousState ?? '∅'} → ${l.newState ?? '∅'}` : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Pill tone={outcomeTone(l.outcome)}>{l.outcome}</Pill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function NotificationLog() {
  const [q, setQ] = useState('')
  const [channel, setChannel] = useState('all')
  const { data, error, isLoading, mutate } = useSWR<{ notifications: NotificationRecord[] }>(`/api/notifications${qs({ q: q.trim() || undefined, channel })}`, fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true,
  })
  const list = data?.notifications ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca destinatario, oggetto, ticket…" className="h-9 w-72 bg-card pl-8" aria-label="Cerca notifiche" />
        </div>
        <FilterSelect
          label="Canale"
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'all', label: 'Tutti i canali' },
            { value: 'EMAIL', label: 'Email' },
            { value: 'REMEDY_COMMENT', label: 'Remedy Comment' },
            { value: 'WORKFLOW_ALERT', label: 'Workflow Alert' },
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">Simulate: nessun messaggio è inviato a destinatari reali</span>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock rows={6} />
      ) : list.length === 0 ? (
        <EmptyState icon={Mail} title="Nessuna notifica" />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((n) => (
            <li key={n.notificationId}>
              <Card className="gap-2 py-3">
                <CardContent className="flex flex-col gap-1.5 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{n.subject}</span>
                    <div className="flex items-center gap-2">
                      <Pill tone="info">{n.channel}</Pill>
                      <StatusBadge status={n.deliveryStatus} />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{n.message}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <Mono>{n.notificationId}</Mono>
                    <span>→ {n.recipient}</span>
                    <span>
                      {n.agencyId} — {n.agencyName}
                    </span>
                    <Link href={`/tickets/${n.ticketId}`} className="font-mono text-primary hover:underline">
                      {n.ticketId}
                    </Link>
                    {n.artifactIds.length > 0 && <span>Artefatti: {n.artifactIds.join(', ')}</span>}
                    <span>{fmtDateTime(n.timestamp)}</span>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
