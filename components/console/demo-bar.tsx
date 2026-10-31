'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ClipboardCheck, Pause, Play, RotateCcw, RotateCw, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiSend, fetcher, refreshAll } from '@/lib/client/api'
import type { HumanTask, WorkflowInstance } from '@/lib/domain/schemas'
import { cn } from '@/lib/utils'
import { FilterSelect, Spinner } from './kit'
import { useSession } from './session-provider'

const SCENARIOS = [
  { id: 'A', label: 'A — Report sinistri (MI001, HITL)' },
  { id: 'B', label: 'B — Copia polizza (RM014, automatico)' },
  { id: 'C', label: 'C — Abilitazione accessi (TO008, HITL)' },
  { id: 'D', label: 'D — Guasto e recovery (NA023)' },
] as const

const SPEEDS = [
  { value: 'instant', label: 'Instant' },
  { value: 'fast', label: 'Fast' },
  { value: 'normal', label: 'Normal' },
  { value: 'slow', label: 'Slow' },
]

export function DemoBar() {
  const router = useRouter()
  const { session, reload, can } = useSession()
  const [busy, setBusy] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [confirm, setConfirm] = useState('')

  const settings = session?.settings
  const ready = Boolean(session?.integration && settings && !session.contextError)
  if (!ready || !settings) return null
  const isAdmin = can('admin')

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try {
      await fn()
      await reload()
      await refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const patch = (body: Record<string, unknown>) => apiSend('/api/settings', body, 'PATCH')

  const startScenario = (id: string) =>
    run(`scenario-${id}`, async () => {
      const res = await apiSend<{ instanceId: string | null; duplicate: boolean }>('/api/demo/scenarios', { scenarioId: id })
      toast.success(`Scenario ${id} avviato`, { description: 'Evento pubblicato su remedy.ticket.created' })
      if (res.instanceId) router.push(`/executions/${res.instanceId}`)
    })

  const approveNext = () =>
    run('approve', async () => {
      const { tasks } = await fetcher<{ tasks: (HumanTask & { canDecide: boolean })[] }>('/api/human-tasks?status=PENDING')
      const task = tasks.find((t) => t.canDecide)
      if (!task) {
        toast.info('Nessuna attività in attesa approvabile da questo utente')
        return
      }
      await apiSend(`/api/human-tasks/${task.taskId}/approve`, { comment: 'Approvato dalla Demo Control Bar' })
      toast.success(`Attività ${task.taskId} approvata`, { description: `Ticket ${task.ticketId} · il workflow riprende` })
    })

  const retryFailed = () =>
    run('retry', async () => {
      const { executions } = await fetcher<{ executions: WorkflowInstance[] }>('/api/executions?status=FAILED')
      const target = executions[0]
      if (!target) {
        toast.info('Nessun workflow fallito da riprovare')
        return
      }
      await apiSend(`/api/executions/${target.instanceId}/retry`)
      toast.success(`Retry avviato per ${target.instanceId}`)
    })

  const reset = () =>
    run('reset', async () => {
      await apiSend('/api/demo/reset', { confirm })
      setResetOpen(false)
      setConfirm('')
      toast.success('Dati demo ripristinati', { description: 'Solo l’ambiente selezionato è stato reinizializzato' })
    })

  return (
    <div className="border-b bg-[#252525] text-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 lg:px-6">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-white/60">Demo Control</span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="sm" className="gap-1.5 bg-primary text-primary-foreground hover:bg-brand-dark" disabled={!isAdmin || busy !== null} />}
          >
            {busy?.startsWith('scenario') ? <Spinner /> : <Play className="size-3.5" aria-hidden />}
            Avvia scenario
            <ChevronDown className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Scenari preconfigurati</DropdownMenuLabel>
              {SCENARIOS.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => startScenario(s.id)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DarkButton
          disabled={!isAdmin || busy !== null}
          onClick={() => run('pause', async () => void (await patch({ paused: !settings.paused })))}
          active={settings.paused}
        >
          {settings.paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
          {settings.paused ? 'Riprendi simulazione' : 'Pausa simulazione'}
        </DarkButton>

        <DarkButton
          disabled={!isAdmin || busy !== null}
          active={settings.injectFailureNext}
          onClick={() =>
            run('inject', async () => {
              await patch({ injectFailureNext: !settings.injectFailureNext })
              toast.message(settings.injectFailureNext ? 'Iniezione guasto disattivata' : 'Il prossimo workflow fallirà nella generazione documento')
            })
          }
        >
          <Zap className="size-3.5" aria-hidden />
          {settings.injectFailureNext ? 'Guasto armato' : 'Inietta guasto'}
        </DarkButton>

        <DarkButton disabled={!can('approver') || busy !== null} onClick={approveNext}>
          {busy === 'approve' ? <Spinner /> : <ClipboardCheck className="size-3.5" aria-hidden />}
          Approva prossima attività
        </DarkButton>

        <DarkButton disabled={!isAdmin || busy !== null} onClick={retryFailed}>
          {busy === 'retry' ? <Spinner /> : <RotateCw className="size-3.5" aria-hidden />}
          Retry workflow fallito
        </DarkButton>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-white/60">Velocità</span>
          <FilterSelect
            label="Velocità simulazione"
            value={settings.simulationSpeed}
            options={SPEEDS}
            onChange={(v) => isAdmin && run('speed', async () => void (await patch({ simulationSpeed: v })))}
            className="h-8 min-w-28 border-white/20 bg-white/10 text-white"
          />
          <DarkButton disabled={!isAdmin || busy !== null} onClick={() => setResetOpen(true)}>
            <RotateCcw className="size-3.5" aria-hidden />
            Reset demo
          </DarkButton>
        </div>
      </div>
      {!isAdmin && <p className="px-4 pb-2 text-[11px] text-white/60 lg:px-6">Controlli presenter disponibili solo per il ruolo admin. Cambia utente dal menu in alto a destra.</p>}

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ripristinare i dati demo?</AlertDialogTitle>
            <AlertDialogDescription>
              Tutti i ticket, workflow, messaggi Kafka, attività, artefatti e log dell’ambiente «{session?.environments.find((e) => e.environmentId === session.integration?.environmentId)?.name}» verranno eliminati e ricaricati con il dataset sintetico. Gli altri ambienti non vengono toccati.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-confirm">Digita RESET per confermare</Label>
            <Input id="reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <Button variant="destructive" disabled={confirm !== 'RESET' || busy === 'reset'} onClick={reset}>
              {busy === 'reset' ? <Spinner /> : <Trash2 className="size-4" aria-hidden />}
              Ripristina
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DarkButton({ active, className, ...props }: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-40',
        active && 'border-warning/60 bg-warning/20 text-warning',
        className,
      )}
    />
  )
}
