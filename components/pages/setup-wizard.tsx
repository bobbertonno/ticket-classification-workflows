'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, CheckCircle2, Cloud, Database, PlayCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FilterSelect, PageHeader, Pill, Spinner } from '@/components/console/kit'
import { useSession } from '@/components/console/session-provider'
import { apiSend, refreshAll } from '@/lib/client/api'
import type { PublicEnvironment } from '@/lib/client/types'
import { cn } from '@/lib/utils'

type Mode = 'demo' | 'atlas'
type VoyageMode = 'simulated' | 'voyage-api' | 'atlas-auto'
interface Check {
  label: string
  ok: boolean
  detail: string
}

const STEPS = ['Ambiente', 'MongoDB', 'Voyage AI', 'Inizializzazione', 'Avvio']

export function SetupWizard() {
  const router = useRouter()
  const { session, reload, can } = useSession()
  const isAdmin = can('admin')
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<Mode>('demo')
  const [name, setName] = useState('Atlas Demo')
  const [uri, setUri] = useState('')
  const [dbName, setDbName] = useState('generali_automation_demo')
  const [mongoChecks, setMongoChecks] = useState<{ ok: boolean; message: string; checks: Check[] } | null>(null)
  const [voyageMode, setVoyageMode] = useState<VoyageMode>('simulated')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('voyage-4')
  const [voyageResult, setVoyageResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [env, setEnv] = useState<PublicEnvironment | null>(null)
  const [initReport, setInitReport] = useState<{ steps: Check[]; vectorIndex: string; vectorIndexMessage: string | null } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const demoEnv = session?.environments.find((e) => e.builtIn && !e.mongo) ?? session?.environments.find((e) => e.builtIn)

  async function guard<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key)
    try {
      return await fn()
    } catch (e) {
      toast.error((e as Error).message)
      return null
    } finally {
      setBusy(null)
    }
  }

  const testMongo = () =>
    guard('mongo', async () => {
      const r = await apiSend<{ ok: boolean; message: string; checks: Check[] }>('/api/integrations/mongodb/test', { connectionString: uri.trim(), databaseName: dbName.trim() })
      setMongoChecks(r)
      if (!r.ok) toast.error(r.message)
    })

  const testVoyage = () =>
    guard('voyage', async () => {
      const r = await apiSend<{ ok: boolean; message: string }>('/api/integrations/voyage/test', { apiKey: apiKey.trim(), model })
      setVoyageResult(r)
      if (!r.ok) toast.error(r.message)
    })

  const saveEnvironment = () =>
    guard('save', async () => {
      const r = await apiSend<{ environment: PublicEnvironment }>('/api/environments', {
        name: name.trim(),
        type: 'CUSTOM_ATLAS',
        mongo: { connectionString: uri.trim(), databaseName: dbName.trim() },
        voyage: { mode: voyageMode, model, ...(voyageMode === 'voyage-api' ? { apiKey: apiKey.trim() } : {}) },
      })
      setEnv(r.environment)
      setUri('')
      setApiKey('')
      toast.success('Ambiente salvato: credenziali cifrate nel secret manager')
      setStep(3)
    })

  const initialize = () =>
    guard('init', async () => {
      const target = mode === 'demo' ? demoEnv : env
      if (!target) throw new Error('Nessun ambiente selezionato')
      await apiSend('/api/environments/select', { environmentId: target.environmentId })
      const r = await apiSend<{ environment: PublicEnvironment; report: { steps: Check[]; vectorIndex: string; vectorIndexMessage: string | null } }>('/api/setup/initialize', {
        environmentId: target.environmentId,
        reseed: false,
      })
      setEnv(r.environment)
      setInitReport(r.report)
      await reload()
      refreshAll()
      if (r.report.steps.every((s) => s.ok)) setStep(4)
    })

  const canProceed = [true, mongoChecks?.ok === true && name.trim().length >= 2, voyageMode !== 'voyage-api' || voyageResult?.ok === true, !!initReport, true][step]

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Setup Wizard" description="Configura un ambiente demo completamente simulato oppure collega il tuo cluster MongoDB Atlas." />
      <ol className="flex items-center gap-2" aria-label="Passaggi">
        {STEPS.map((s, i) => {
          const skipped = mode === 'demo' && (i === 1 || i === 2)
          return (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                  i < step && 'border-success bg-success text-white',
                  i === step && 'border-primary bg-primary text-primary-foreground',
                  skipped && i > step && 'opacity-40',
                )}
                aria-current={i === step ? 'step' : undefined}
              >
                {i + 1}
              </span>
              <span className={cn('hidden text-xs sm:inline', i === step ? 'font-medium' : 'text-muted-foreground', skipped && 'line-through opacity-60')}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
            </li>
          )
        })}
      </ol>

      {!isAdmin && step > 0 && <p className="text-sm text-destructive">Solo il ruolo admin può configurare ambienti. Cambia utente dalla barra superiore.</p>}

      <Card>
        <CardContent className="flex flex-col gap-5">
          {step === 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  { id: 'demo', icon: PlayCircle, title: 'Demo completamente simulata', body: 'Nessuna credenziale. Dati sintetici in un data provider in-memory chiaramente etichettato. Ideale per presentazioni immediate.' },
                  { id: 'atlas', icon: Cloud, title: 'Bring Your Own MongoDB Atlas', body: 'Persistenza reale su un database dedicato, Atlas Vector Search e (opzionale) embedding Voyage AI reali.' },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setMode(o.id)}
                  aria-pressed={mode === o.id}
                  className={cn('flex flex-col gap-2 rounded-lg border p-4 text-left hover:bg-muted/40', mode === o.id && 'border-primary ring-1 ring-primary/30')}
                >
                  <o.icon className="size-5 text-primary" aria-hidden />
                  <span className="text-sm font-semibold">{o.title}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{o.body}</span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="env-name">Nome ambiente</Label>
                  <Input id="env-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="db-name">Database name</Label>
                  <Input id="db-name" value={dbName} onChange={(e) => setDbName(e.target.value)} maxLength={38} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="uri">Connection string</Label>
                <Input
                  id="uri"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={uri}
                  onChange={(e) => {
                    setUri(e.target.value)
                    setMongoChecks(null)
                  }}
                  placeholder="mongodb+srv://utente:password@cluster0.xxxxx.mongodb.net"
                />
                <p className="text-xs text-muted-foreground">
                  Usa un database user dedicato con ruolo <Mono>readWrite</Mono> + <Mono>dbAdmin</Mono> solo sul database indicato. Sono accettati solo host <Mono>*.mongodb.net</Mono>.
                  La stringa viene inviata solo al server e cifrata nel secret manager.
                </p>
              </div>
              <div>
                <Button variant="outline" onClick={testMongo} disabled={!isAdmin || !!busy || uri.length < 12}>
                  {busy === 'mongo' ? <Spinner /> : <Database className="size-4" aria-hidden />}
                  Test connessione e permessi
                </Button>
              </div>
              {mongoChecks && <CheckList title={mongoChecks.message} ok={mongoChecks.ok} checks={mongoChecks.checks} />}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                {(
                  [
                    { id: 'atlas-auto', title: 'Atlas Integrated Embeddings', body: "Embedding gestiti da Atlas (autoEmbed). Richiede cluster e versione compatibili: verificato all'inizializzazione." },
                    { id: 'voyage-api', title: 'External Voyage AI API', body: 'Embedding generati lato server con la tua API key Voyage AI.' },
                    { id: 'simulated', title: 'Classificazione simulata', body: 'Classificatore deterministico etichettato come simulato. Nessuna chiamata a Voyage AI.' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setVoyageMode(o.id)
                      setVoyageResult(null)
                    }}
                    aria-pressed={voyageMode === o.id}
                    className={cn('flex flex-col gap-1.5 rounded-lg border p-3 text-left hover:bg-muted/40', voyageMode === o.id && 'border-primary ring-1 ring-primary/30')}
                  >
                    <span className="text-sm font-semibold">{o.title}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{o.body}</span>
                  </button>
                ))}
              </div>
              {voyageMode !== 'simulated' && (
                <div className="flex flex-col gap-1.5">
                  <Label>Modello di embedding</Label>
                  <FilterSelect
                    label="Modello"
                    value={model}
                    onChange={setModel}
                    options={['voyage-4', 'voyage-4-large', 'voyage-4-lite', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-multilingual-2'].map((m) => ({ value: m, label: m }))}
                  />
                </div>
              )}
              {voyageMode === 'voyage-api' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="vkey">API key Voyage AI</Label>
                  <Input
                    id="vkey"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      setVoyageResult(null)
                    }}
                    placeholder="pa-…"
                  />
                  <div>
                    <Button variant="outline" onClick={testVoyage} disabled={!isAdmin || !!busy || apiKey.length < 10}>
                      {busy === 'voyage' && <Spinner />}
                      Verifica API key
                    </Button>
                  </div>
                  {voyageResult && <CheckList title={voyageResult.message} ok={voyageResult.ok} checks={[]} />}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm">
                {mode === 'demo'
                  ? "Caricamento del dataset sintetico nel simulatore in-memory (agenzie, ticket storici, workflow, 100+ esempi di classificazione). I dati non sono persistiti in MongoDB."
                  : `Creazione di collection e indici nel database “${env?.mongo?.databaseName}”, caricamento dati sintetici e configurazione del vector search index.`}
              </p>
              <div>
                <Button onClick={initialize} disabled={!isAdmin || !!busy}>
                  {busy === 'init' && <Spinner />}
                  Inizializza database
                </Button>
              </div>
              {initReport && (
                <CheckList
                  title={`Vector Search: ${initReport.vectorIndex}${initReport.vectorIndexMessage ? ` — ${initReport.vectorIndexMessage}` : ''}`}
                  ok={initReport.steps.every((s) => s.ok)}
                  checks={initReport.steps}
                />
              )}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-start gap-3">
              <CheckCircle2 className="size-8 text-success" aria-hidden />
              <h2 className="text-lg font-semibold">Ambiente pronto</h2>
              <p className="text-sm text-muted-foreground">
                Il Kafka Simulator è attivo. Avvia uno scenario dalla Demo Control Bar o pubblica un evento remedy.ticket.created.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => router.push('/')}>Apri Overview</Button>
                <Button variant="outline" onClick={() => router.push('/kafka')}>
                  Kafka Simulator
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {step < 4 && (
        <div className="flex justify-between">
          <Button variant="ghost" disabled={step === 0 || !!busy} onClick={() => setStep(mode === 'demo' && step === 3 ? 0 : step - 1)}>
            <ArrowLeft className="size-4" aria-hidden />
            Indietro
          </Button>
          {step === 2 ? (
            <Button onClick={saveEnvironment} disabled={!isAdmin || !canProceed || !!busy}>
              {busy === 'save' && <Spinner />}
              Salva in modo sicuro
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : step === 3 ? (
            <Button onClick={() => setStep(4)} disabled={!canProceed || !initReport?.steps.every((s) => s.ok)}>
              Avanti
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => setStep(step === 0 && mode === 'demo' ? 3 : step + 1)} disabled={!canProceed || !!busy}>
              Avanti
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-[11px]">{children}</code>
}

function CheckList({ title, ok, checks }: { title: string; ok: boolean; checks: Check[] }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-md border p-3', ok ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5')}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-destructive" aria-hidden />}
        {title}
        <Pill tone={ok ? 'success' : 'error'} className="ml-auto">
          {ok ? 'OK' : 'Errore'}
        </Pill>
      </div>
      {checks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-xs">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />}
              <span>
                <span className="font-medium">{c.label}</span> <span className="text-muted-foreground">— {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
