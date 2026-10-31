'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Save, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, ErrorState, Field, FilterSelect, JsonBlock, LoadingBlock, Mono, PageHeader, Pill, Spinner, StatusBadge } from '@/components/console/kit'
import { useSession } from '@/components/console/session-provider'
import { WorkflowDiagram } from '@/components/console/workflow-diagram'
import { apiSend, fetcher } from '@/lib/client/api'
import { fmtDateTime, MODE_LABELS } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { CATEGORY_LABELS } from '@/lib/domain/seed-data'
import type { WorkflowDefinition } from '@/lib/domain/schemas'

type WorkflowRow = WorkflowDefinition & { usage: { total: number; completed: number; failed: number } }

const modeTone = (m: string) => (m === 'AUTOMATED' ? 'success' : m === 'HITL' ? 'brand' : 'warning') as 'success' | 'brand' | 'warning'

export function WorkflowsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ workflows: WorkflowRow[] }>('/api/workflows', fetcher, { refreshInterval: 10000 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const workflows = data?.workflows ?? []
  const selected = workflows.find((w) => w.workflowId === selectedId) ?? workflows[0]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Workflow Catalog" description="Definizioni di automazione riutilizzabili. La configurazione è modificabile tramite form validati; la struttura degli step è fissata dall'engine MVP." />
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock rows={6} />
      ) : workflows.length === 0 ? (
        <EmptyState icon={Workflow} title="Nessun workflow definito" description="Inizializza l'ambiente dal Setup Wizard per caricare il catalogo." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_1fr]">
          <ul className="flex flex-col gap-2" aria-label="Workflow">
            {workflows.map((w) => (
              <li key={w.workflowId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(w.workflowId)}
                  aria-pressed={w.workflowId === selected?.workflowId}
                  className={cn('flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-xs hover:bg-muted/40', w.workflowId === selected?.workflowId && 'border-primary ring-1 ring-primary/30')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{w.name}</span>
                    <StatusBadge status={w.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Mono className="text-muted-foreground">
                      {w.workflowId} · v{w.version}
                    </Mono>
                    <Pill tone={modeTone(w.executionMode)}>{MODE_LABELS[w.executionMode]}</Pill>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {w.usage.total} esecuzioni · {w.usage.completed} completate · {w.usage.failed} fallite
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <WorkflowDetail key={selected.workflowId} workflow={selected} onSaved={() => mutate()} />}
        </div>
      )}
    </div>
  )
}

function WorkflowDetail({ workflow, onSaved }: { workflow: WorkflowRow; onSaved: () => void }) {
  const { can } = useSession()
  const isAdmin = can('admin')
  const [sla, setSla] = useState(String(workflow.slaMinutes))
  const [maxAttempts, setMaxAttempts] = useState(String(workflow.retryPolicy.maxAttempts))
  const [backoff, setBackoff] = useState(String(workflow.retryPolicy.backoffMs))
  const [status, setStatus] = useState<string>(workflow.status)
  const [team, setTeam] = useState(workflow.approvalPolicy.assignedTeam)
  const [onReject, setOnReject] = useState<string>(workflow.approvalPolicy.onReject)
  const [saving, setSaving] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const step = workflow.steps[stepIdx]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await apiSend(
        `/api/workflows/${workflow.workflowId}`,
        {
          slaMinutes: Number(sla),
          status,
          retryPolicy: { maxAttempts: Number(maxAttempts), backoffMs: Number(backoff) },
          approvalPolicy: { assignedTeam: team, onReject },
        },
        'PATCH',
      )
      toast.success('Configurazione workflow salvata')
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{workflow.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{workflow.description}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Categoria">{CATEGORY_LABELS[workflow.category]}</Field>
            <Field label="Trigger topic">
              <Mono className="text-primary">{workflow.triggerTopic}</Mono>
            </Field>
            <Field label="Modalità">{MODE_LABELS[workflow.executionMode]}</Field>
            <Field label="Aggiornato">{fmtDateTime(workflow.updatedAt)}</Field>
            <Field label="SLA">{workflow.slaMinutes} min</Field>
            <Field label="Retry">
              {workflow.retryPolicy.maxAttempts} tentativi / {workflow.retryPolicy.backoffMs} ms
            </Field>
            <Field label="Approvazione">{workflow.approvalPolicy.required ? `Richiesta (${workflow.approvalPolicy.approverRole})` : 'Non richiesta'}</Field>
            <Field label="Su rifiuto">{workflow.approvalPolicy.onReject === 'escalate' ? 'Escalation' : 'Annulla'}</Field>
          </dl>
          <WorkflowDiagram steps={workflow.steps.map((s) => ({ stepId: s.id, type: s.type, label: s.label, status: 'PENDING' as const }))} currentIndex={-1} height={300} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ispeziona step</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ol className="flex flex-wrap gap-1.5">
              {workflow.steps.map((s, i) => (
                <li key={s.id}>
                  <Button size="xs" variant={i === stepIdx ? 'default' : 'outline'} onClick={() => setStepIdx(i)}>
                    {i + 1}. {s.label}
                  </Button>
                </li>
              ))}
            </ol>
            {step && (
              <>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="Tipo">
                    <Mono>{step.type}</Mono>
                  </Field>
                  <Field label="Handler">
                    <Mono>{step.handler}</Mono>
                  </Field>
                </dl>
                <JsonBlock value={step.config} />
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Configurazione</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="flex flex-col gap-3">
              <fieldset disabled={!isAdmin || saving} className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wf-sla">SLA (minuti)</Label>
                  <Input id="wf-sla" type="number" min={5} max={10080} value={sla} onChange={(e) => setSla(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Stato</Label>
                  <FilterSelect label="Stato" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'ACTIVE' }, { value: 'DRAFT', label: 'DRAFT' }, { value: 'DEPRECATED', label: 'DEPRECATED' }]} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wf-att">Tentativi massimi</Label>
                  <Input id="wf-att" type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wf-back">Backoff (ms)</Label>
                  <Input id="wf-back" type="number" min={0} max={600000} value={backoff} onChange={(e) => setBackoff(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="wf-team">Team approvatore</Label>
                  <Input id="wf-team" value={team} onChange={(e) => setTeam(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Percorso di rifiuto</Label>
                  <FilterSelect label="Rifiuto" value={onReject} onChange={setOnReject} options={[{ value: 'escalate', label: 'Escalation' }, { value: 'cancel', label: 'Annulla' }]} />
                </div>
              </fieldset>
              {!isAdmin && <p className="text-xs text-muted-foreground">Solo il ruolo admin può modificare la configurazione.</p>}
              <div>
                <Button type="submit" disabled={!isAdmin || saving}>
                  {saving ? <Spinner /> : <Save className="size-4" aria-hidden />}
                  Salva configurazione
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
