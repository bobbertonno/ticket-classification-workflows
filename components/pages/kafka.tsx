'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { RefreshCw, Send, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/components/console/session-provider'
import { EmptyState, ErrorState, Field, FilterSelect, JsonBlock, LoadingBlock, Mono, PageHeader, SimulatedNotice, Spinner, StatusBadge, useAgencies } from '@/components/console/kit'
import { apiSend, fetcher, qs, refreshAll } from '@/lib/client/api'
import { fmtDateTime, fmtTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { PublishEventSchema, TOPICS, type KafkaMessage } from '@/lib/domain/schemas'
import type { DemoScenario } from '@/lib/domain/seed-data'

interface TopicStat {
  topic: string
  messageCount: number
  lastPublishedAt: string | null
  lastEventType: string | null
  consumed: number
  pending: number
  failed: number
  duplicates: number
}

const PRIORITIES = [
  { value: 'LOW', label: 'Bassa' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'CRITICAL', label: 'Critica' },
]

const newTicketId = () => `INC${String(Math.floor(Math.random() * 9_000_000) + 1_000_000).padStart(9, '0')}`

export function KafkaSimulator() {
  const [topic, setTopic] = useState<string>('all')
  const [selected, setSelected] = useState<KafkaMessage | null>(null)
  const { data, error, isLoading, mutate } = useSWR<{ topics: TopicStat[]; messages: KafkaMessage[] }>(`/api/kafka/messages${qs({ topic })}`, fetcher, { refreshInterval: 2500, keepPreviousData: true })

  return (
    <>
      <PageHeader
        title="Kafka Simulator"
        description="Console di pubblicazione eventi sintetici. I messaggi vengono persistiti come se fossero consumati da topic Kafka e attivano il workflow corrispondente."
      />
      <SimulatedNotice>
        Nessun broker Kafka reale è collegato: i topic sono simulati e persistiti nello store dell’ambiente selezionato, con garanzie di idempotenza per eventId.
      </SimulatedNotice>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <PublishPanel onPublished={() => mutate()} />

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Topic browser</CardTitle>
              <CardDescription>Seleziona un topic per filtrare la cronologia messaggi</CardDescription>
            </CardHeader>
            <CardContent>
              {error && <ErrorState error={error} onRetry={() => mutate()} />}
              {!data && isLoading && <LoadingBlock rows={4} />}
              {data && (
                <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                  {data.topics.map((t) => {
                    const active = topic === t.topic
                    return (
                      <button
                        key={t.topic}
                        type="button"
                        onClick={() => setTopic(active ? 'all' : t.topic)}
                        aria-pressed={active}
                        className={cn(
                          'flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40',
                          active && 'border-primary bg-accent',
                          t.topic === 'automation.dead-letter' && t.messageCount > 0 && 'border-destructive/40',
                        )}
                      >
                        <span className="truncate font-mono text-[11px] font-medium">{t.topic}</span>
                        <span className="text-xl font-semibold tabular-nums">{t.messageCount}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {t.consumed} consumati · {t.pending} in coda · {t.failed} errori{t.duplicates ? ` · ${t.duplicates} duplicati` : ''}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">Ultimo: {t.lastPublishedAt ? `${t.lastEventType} · ${fmtTime(t.lastPublishedAt)}` : '—'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-sm">Cronologia messaggi</CardTitle>
                <CardDescription>{topic === 'all' ? 'Tutti i topic' : topic} · ultimi 200 messaggi</CardDescription>
              </div>
              <FilterSelect label="Topic" value={topic} onChange={setTopic} options={[{ value: 'all', label: 'Tutti i topic' }, ...TOPICS.map((t) => ({ value: t, label: t }))]} className="min-w-64" />
            </CardHeader>
            <CardContent>
              {data && data.messages.length === 0 && <EmptyState title="Nessun messaggio" description="Pubblica un evento dal pannello a sinistra." />}
              {data && data.messages.length > 0 && (
                <div className="max-h-[560px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Topic</TableHead>
                        <TableHead>Event type</TableHead>
                        <TableHead>Ticket</TableHead>
                        <TableHead>Agenzia</TableHead>
                        <TableHead>Consumer</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.messages.map((m) => (
                        <TableRow key={m.eventId} className="cursor-pointer" onClick={() => setSelected(m)}>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums">{fmtTime(m.timestamp)}</TableCell>
                          <TableCell>
                            <Mono className="text-[11px]">{m.topic}</Mono>
                          </TableCell>
                          <TableCell className="text-xs">
                            {m.eventType}
                            {m.replayOf && <span className="ml-1 text-muted-foreground">(replay)</span>}
                          </TableCell>
                          <TableCell>
                            <Mono>{m.ticketId}</Mono>
                          </TableCell>
                          <TableCell className="text-xs">{m.agencyId}</TableCell>
                          <TableCell>
                            <StatusBadge status={m.consumerStatus} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <MessageSheet message={selected} onClose={() => setSelected(null)} onReplayed={() => mutate()} />
    </>
  )
}

function PublishPanel({ onPublished }: { onPublished: () => void }) {
  const { can } = useSession()
  const { data: ag } = useAgencies()
  const { data: sc } = useSWR<{ scenarios: DemoScenario[] }>('/api/demo/scenarios', fetcher)
  const agencies = ag?.agencies ?? []

  const [scenarioId, setScenarioId] = useState('custom')
  const [agencyId, setAgencyId] = useState('MI001')
  const [ticketId, setTicketId] = useState(newTicketId)
  const [operatorName, setOperator] = useState('')
  const [priority, setPriority] = useState('MEDIUM')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [extraJson, setExtraJson] = useState('{\n  "channel": "Remedy Web"\n}')
  const [busy, setBusy] = useState(false)

  const agency = agencies.find((a) => a.agencyId === agencyId)
  const operator = operatorName || agency?.operatorName || ''

  const jsonResult = useMemo(() => {
    try {
      const v = JSON.parse(extraJson || '{}')
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false as const, error: 'Il metadata deve essere un oggetto JSON' }
      return { ok: true as const, value: v as Record<string, unknown> }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  }, [extraJson])

  const candidate = {
    scenarioId: scenarioId === 'custom' ? undefined : scenarioId,
    topic: 'remedy.ticket.created' as const,
    agencyId,
    ticketId,
    operatorName: operator,
    priority,
    subject,
    description,
    metadata: jsonResult.ok ? jsonResult.value : undefined,
  }
  const validation = PublishEventSchema.safeParse(candidate)
  const issues = validation.success ? [] : validation.error.issues.map((i) => `${i.path.join('.') || 'evento'}: ${i.message}`)
  const preview = {
    eventType: 'RemedyTicketCreated',
    topic: 'remedy.ticket.created',
    ticketId,
    agencyId,
    agencyName: agency?.agencyName ?? null,
    schemaVersion: '1.0.0',
    payload: { subject, description, priority, requestedBy: operator },
    metadata: jsonResult.ok ? jsonResult.value : '«JSON non valido»',
  }

  function applyScenario(id: string) {
    setScenarioId(id)
    const s = sc?.scenarios.find((x) => x.scenarioId === id)
    if (!s) return
    setAgencyId(s.agencyId)
    setPriority(s.priority)
    setSubject(s.subject)
    setDescription(s.description)
    setOperator('')
    setExtraJson(JSON.stringify(s.metadata, null, 2))
    setTicketId(newTicketId())
  }

  async function publish() {
    if (!validation.success || !jsonResult.ok) return
    setBusy(true)
    try {
      const res = await apiSend<{ duplicate: boolean; instanceId: string | null; message: KafkaMessage }>('/api/kafka/publish', validation.data)
      if (res.duplicate) toast.warning('Evento duplicato ignorato', { description: 'Idempotenza: nessun nuovo workflow creato' })
      else
        toast.success('Evento pubblicato su remedy.ticket.created', {
          description: `${res.message.eventId} · ${res.instanceId ?? 'nessun workflow'}`,
          action: res.instanceId ? { label: 'Apri', onClick: () => (window.location.href = `/executions/${res.instanceId}`) } : undefined,
        })
      setTicketId(newTicketId())
      onPublished()
      await refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scenarioOpts = [{ value: 'custom', label: 'Evento personalizzato' }, ...(sc?.scenarios ?? []).map((s) => ({ value: s.scenarioId, label: s.title }))]
  const agencyOpts = agencies.map((a) => ({ value: a.agencyId, label: `${a.agencyId} — ${a.agencyName}` }))

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="text-sm">Pubblica evento</CardTitle>
        <CardDescription>Topic: remedy.ticket.created · schema v1.0.0</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void publish()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Scenario</Label>
            <FilterSelect label="Scenario" value={scenarioId} onChange={applyScenario} options={scenarioOpts} className="w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Agenzia di origine</Label>
              <FilterSelect label="Agenzia" value={agencyId} onChange={setAgencyId} options={agencyOpts.length ? agencyOpts : [{ value: agencyId, label: agencyId }]} className="w-full" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-id">Ticket ID</Label>
              <div className="flex gap-1">
                <Input id="ticket-id" value={ticketId} onChange={(e) => setTicketId(e.target.value.toUpperCase())} className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={() => setTicketId(newTicketId())} aria-label="Genera nuovo Ticket ID">
                  <Shuffle className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priorità</Label>
              <FilterSelect label="Priorità" value={priority} onChange={setPriority} options={PRIORITIES} className="w-full min-w-0" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="operator">Operatore</Label>
              <Input id="operator" value={operatorName} placeholder={agency?.operatorName ?? 'Nome operatore'} onChange={(e) => setOperator(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subject">Oggetto</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Es. Richiesta report sinistri" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Descrizione ticket</Label>
            <Textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrivi la richiesta in linguaggio naturale" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="metadata">Metadata (JSON)</Label>
            <Textarea id="metadata" rows={4} value={extraJson} onChange={(e) => setExtraJson(e.target.value)} className={cn('font-mono text-xs', !jsonResult.ok && 'border-destructive')} spellCheck={false} />
            {!jsonResult.ok && <p className="text-xs text-destructive">JSON non valido: {jsonResult.error}</p>}
          </div>
          <details className="rounded-md border bg-muted/30 p-2">
            <summary className="cursor-pointer text-xs font-medium">Anteprima evento</summary>
            <JsonBlock value={preview} className="mt-2 border-0 bg-transparent p-0" />
          </details>
          {issues.length > 0 && (subject || description) && (
            <ul className="flex flex-col gap-0.5 rounded-md border border-warning/30 bg-warning/8 p-2 text-xs text-[#6b4a0a]">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <Button type="submit" disabled={busy || !validation.success || !jsonResult.ok || !can('approver')}>
            {busy ? <Spinner /> : <Send className="size-4" aria-hidden />}
            Publish Event
          </Button>
          {!can('approver') && <p className="text-xs text-muted-foreground">Il ruolo corrente è in sola lettura.</p>}
        </form>
      </CardContent>
    </Card>
  )
}

function MessageSheet({ message, onClose, onReplayed }: { message: KafkaMessage | null; onClose: () => void; onReplayed: () => void }) {
  const { can } = useSession()
  const [busy, setBusy] = useState(false)
  async function replay() {
    if (!message) return
    setBusy(true)
    try {
      const res = await apiSend<{ outcome: string }>('/api/kafka/replay', { eventId: message.eventId })
      toast.success('Replay eseguito', { description: res.outcome })
      onReplayed()
      await refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={Boolean(message)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {message && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-sm">{message.eventId}</SheetTitle>
              <SheetDescription>
                {message.topic} · partizione {message.partition}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Event type">{message.eventType}</Field>
                <Field label="Timestamp">{fmtDateTime(message.timestamp)}</Field>
                <Field label="Correlation ID">
                  <Mono>{message.correlationId}</Mono>
                </Field>
                <Field label="Schema version">{message.schemaVersion}</Field>
                <Field label="Ticket">
                  <Link href={`/tickets/${message.ticketId}`} className="font-mono text-xs text-primary hover:underline">
                    {message.ticketId}
                  </Link>
                </Field>
                <Field label="Workflow instance">
                  {message.workflowInstanceId ? (
                    <Link href={`/executions/${message.workflowInstanceId}`} className="font-mono text-xs text-primary hover:underline">
                      {message.workflowInstanceId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="Agenzia">
                  {message.agencyId} — {message.agencyName}
                </Field>
                <Field label="Consumer">
                  <StatusBadge status={message.consumerStatus} />
                </Field>
                {message.replayOf && (
                  <Field label="Replay di">
                    <Mono>{message.replayOf}</Mono>
                  </Field>
                )}
              </dl>
              {message.consumerError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs text-destructive">{message.consumerError}</p>}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">Payload</span>
                <JsonBlock value={message.payload} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">Metadata</span>
                <JsonBlock value={message.metadata} />
              </div>
              {message.topic === 'remedy.ticket.created' && (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Il replay ripubblica l’evento con lo stesso eventId logico: il consumer verifica l’idempotenza e non crea un secondo workflow.
                  </p>
                  <Button variant="outline" size="sm" onClick={replay} disabled={busy || !can('admin')}>
                    {busy ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
                    Replay evento
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
