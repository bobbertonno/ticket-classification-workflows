'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Check, ClipboardCheck, MessageSquare, PencilLine, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { ArtifactList, type ArtifactWithLink } from '@/components/console/artifact-list'
import { AgencyFilter, EmptyState, ErrorState, Field, FilterSelect, LoadingBlock, Mono, PageHeader, Pill, Spinner, StatusBadge } from '@/components/console/kit'
import { useSession } from '@/components/console/session-provider'
import { priorityTone } from '@/components/pages/tickets'
import { apiSend, fetcher, qs, refreshAll } from '@/lib/client/api'
import { fmtDateTime, PRIORITY_LABELS } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { CATEGORY_LABELS } from '@/lib/domain/seed-data'
import { CATEGORIES, type Category, type HumanTask, type RemedyTicket } from '@/lib/domain/schemas'

type TaskRow = HumanTask & { slaStatus: 'CLOSED' | 'BREACHED' | 'AT_RISK' | 'ON_TRACK'; canDecide: boolean }

const APPROVAL_LABELS: Record<HumanTask['approvalType'], string> = {
  REPORT_APPROVAL: 'Approvazione report',
  ACCESS_APPROVAL: 'Approvazione accesso',
  MANUAL_TRIAGE: 'Triage manuale',
  DOCUMENT_APPROVAL: 'Approvazione documento',
}
const SLA: Record<TaskRow['slaStatus'], { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' }> = {
  ON_TRACK: { label: 'In linea', tone: 'success' },
  AT_RISK: { label: 'A rischio', tone: 'warning' },
  BREACHED: { label: 'Scaduto', tone: 'error' },
  CLOSED: { label: 'Chiuso', tone: 'neutral' },
}

export function TasksPage() {
  const router = useRouter()
  const search = useSearchParams()
  const [status, setStatus] = useState('PENDING')
  const [agencyId, setAgencyId] = useState('all')
  const { data, error, isLoading, mutate } = useSWR<{ tasks: TaskRow[] }>(`/api/human-tasks${qs({ status, agencyId })}`, fetcher, { refreshInterval: 2000, keepPreviousData: true })
  const tasks = data?.tasks ?? []
  const selectedId = search.get('task') ?? tasks[0]?.taskId ?? null
  const selected = tasks.find((t) => t.taskId === selectedId) ?? null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Human Tasks" description="Inbox Human-in-the-Loop: le decisioni riprendono automaticamente il workflow tramite l'engine di simulazione." />
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Stato"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'PENDING', label: 'In attesa' },
            { value: 'APPROVED', label: 'Approvati' },
            { value: 'REJECTED', label: 'Rifiutati' },
            { value: 'CHANGES_REQUESTED', label: 'Modifiche richieste' },
            { value: 'all', label: 'Tutti' },
          ]}
        />
        <AgencyFilter value={agencyId} onChange={setAgencyId} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock rows={6} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nessun task" description="Avvia lo Scenario A o C per generare una richiesta di approvazione." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <ul className="flex flex-col gap-2 lg:col-span-2" aria-label="Task">
            {tasks.map((t) => (
              <li key={t.taskId}>
                <button
                  type="button"
                  onClick={() => router.replace(`/tasks?task=${t.taskId}`, { scroll: false })}
                  aria-pressed={t.taskId === selected?.taskId}
                  className={cn(
                    'flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:bg-muted/40',
                    t.taskId === selected?.taskId && 'border-primary ring-1 ring-primary/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug">{t.title}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Mono>{t.taskId}</Mono>·<span>{t.agencyId}</span>·<span>{APPROVAL_LABELS[t.approvalType]}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Pill tone={priorityTone(t.priority)}>{PRIORITY_LABELS[t.priority]}</Pill>
                    <Pill tone={SLA[t.slaStatus].tone}>{SLA[t.slaStatus].label}</Pill>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="lg:col-span-3">{selected ? <TaskDetail key={selected.taskId} task={selected} onChanged={() => mutate()} /> : null}</div>
        </div>
      )}
    </div>
  )
}

function TaskDetail({ task, onChanged }: { task: TaskRow; onChanged: () => void }) {
  const { session } = useSession()
  const [comment, setComment] = useState('')
  const [override, setOverride] = useState<string>('none')
  const [busy, setBusy] = useState<string | null>(null)
  const { data: ticketData } = useSWR<{ ticket: RemedyTicket }>(`/api/tickets/${task.ticketId}`, fetcher)
  const { data: art } = useSWR<{ artifacts: ArtifactWithLink[] }>(`/api/artifacts?instanceId=${task.instanceId}`, fetcher, { refreshInterval: 4000 })
  const pending = task.status === 'PENDING'

  async function send(action: 'approve' | 'reject' | 'request-changes' | 'comment') {
    if ((action === 'reject' || action === 'request-changes' || action === 'comment') && !comment.trim()) {
      toast.error('Aggiungi un commento per motivare la decisione')
      return
    }
    setBusy(action)
    try {
      const body =
        action === 'comment'
          ? { text: comment.trim() }
          : { comment: comment.trim(), ...(override !== 'none' && task.approvalType === 'MANUAL_TRIAGE' ? { overrideCategory: override as Category } : {}) }
      await apiSend(`/api/human-tasks/${task.taskId}/${action}`, body)
      toast.success(
        action === 'approve' ? 'Approvato: workflow ripreso' : action === 'reject' ? 'Rifiutato: percorso di rifiuto avviato' : action === 'comment' ? 'Commento aggiunto' : 'Modifiche richieste',
      )
      setComment('')
      onChanged()
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">{task.title}</CardTitle>
            <span className="text-xs text-muted-foreground">{APPROVAL_LABELS[task.approvalType]}</span>
          </div>
          <StatusBadge status={task.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Task ID">
              <Mono>{task.taskId}</Mono>
            </Field>
            <Field label="Istanza workflow">
              <Link href={`/executions/${task.instanceId}`} className="font-mono text-xs text-primary hover:underline">
                {task.instanceId}
              </Link>
            </Field>
            <Field label="Ticket Remedy">
              <Link href={`/tickets/${task.ticketId}`} className="font-mono text-xs text-primary hover:underline">
                {task.ticketId}
              </Link>
            </Field>
            <Field label="Agenzia">
              {task.agencyId} — {task.agencyName}
            </Field>
            <Field label="Operatore richiedente">{task.operatorName}</Field>
            <Field label="Team assegnato">{task.assignedTeam}</Field>
            <Field label="Ruolo richiesto">{task.assignedRole}</Field>
            <Field label="Scadenza">{fmtDateTime(task.dueAt)}</Field>
            <Field label="SLA">
              <Pill tone={SLA[task.slaStatus].tone}>{SLA[task.slaStatus].label}</Pill>
            </Field>
          </dl>
          {ticketData?.ticket && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">Contesto ticket</p>
              <p className="mt-1 text-sm font-medium">{ticketData.ticket.subject}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{ticketData.ticket.description}</p>
            </div>
          )}
          {task.decision && (
            <div className="rounded-md border p-3 text-sm">
              <p>
                <span className="font-medium">{task.decision.decision}</span> da {task.decision.approver} · {fmtDateTime(task.decision.timestamp)}
              </p>
              <p className="text-xs text-muted-foreground">
                Stato: {task.decision.previousState} → {task.decision.newState}
              </p>
              {task.decision.comment && <p className="mt-1 text-muted-foreground">“{task.decision.comment}”</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Artefatti da revisionare</CardTitle>
        </CardHeader>
        <CardContent>
          <ArtifactList artifacts={art?.artifacts ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Decisione</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {task.comments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {task.comments.map((c, i) => (
                <li key={`${c.at}-${i}`} className="flex gap-2 text-sm">
                  <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="font-medium">{c.author}</span> <span className="text-xs text-muted-foreground">{fmtDateTime(c.at)}</span>
                    <br />
                    {c.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!task.canDecide && pending && (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/8 p-3 text-xs">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                L&apos;utente corrente ({session?.actor.name ?? '—'}, ruolo {session?.actor.role ?? '—'}) non è autorizzato a decidere su questo task. Il controllo è applicato anche
                lato server. Cambia utente dalla barra superiore.
              </span>
            </div>
          )}
          {task.approvalType === 'MANUAL_TRIAGE' && pending && (
            <FilterSelect
              label="Categoria corretta"
              value={override}
              onChange={setOverride}
              options={[{ value: 'none', label: `Conferma suggerita (${task.suggestedCategory ? CATEGORY_LABELS[task.suggestedCategory] : '—'})` }, ...CATEGORIES.filter((c) => c !== 'UNKNOWN').map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
            />
          )}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Commento (obbligatorio per rifiuto o richiesta modifiche)" rows={3} aria-label="Commento" maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!pending || !task.canDecide || !!busy} onClick={() => send('approve')} className="bg-success text-white hover:bg-success/90">
              {busy === 'approve' ? <Spinner /> : <Check className="size-4" aria-hidden />}
              Approva
            </Button>
            <Button variant="outline" disabled={!pending || !task.canDecide || !!busy} onClick={() => send('reject')} className="border-destructive/40 text-destructive hover:bg-destructive/5">
              {busy === 'reject' ? <Spinner /> : <X className="size-4" aria-hidden />}
              Rifiuta
            </Button>
            <Button variant="outline" disabled={!pending || !task.canDecide || !!busy} onClick={() => send('request-changes')}>
              {busy === 'request-changes' ? <Spinner /> : <PencilLine className="size-4" aria-hidden />}
              Richiedi modifiche
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => send('comment')}>
              {busy === 'comment' ? <Spinner /> : <MessageSquare className="size-4" aria-hidden />}
              Aggiungi commento
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
