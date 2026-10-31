'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Database, KeyRound, Plus, Save, Server, Sparkles, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Field, FilterSelect, LoadingBlock, Mono, PageHeader, Pill, SimulatedNotice, Spinner, StatusBadge } from '@/components/console/kit'
import { useSession } from '@/components/console/session-provider'
import { apiSend, refreshAll } from '@/lib/client/api'
import { fmtDateTime } from '@/lib/client/format'
import type { PublicEnvironment } from '@/lib/client/types'
import type { AppSettings } from '@/lib/domain/schemas'

export function SettingsPage() {
  const { session, isLoading } = useSession()
  if (isLoading || !session) return <LoadingBlock rows={8} />
  const selectedId = session.integration?.environmentId

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Impostazioni e integrazioni"
        description="Ambienti, connessioni MongoDB Atlas, Voyage AI e parametri applicativi."
        actions={
          <Button nativeButton={false} render={<Link href="/settings/setup" />}>
            <Plus className="size-4" aria-hidden />
            Setup Wizard
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Piattaforma (control plane)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid gap-4 md:grid-cols-2">
            <Field label="Control plane">
              {session.platform.controlPlane} {session.platform.controlPlanePersistent ? <Pill tone="success">persistente</Pill> : <Pill tone="warning">non persistente</Pill>}
            </Field>
            <Field label="Secret manager">
              {session.platform.secretManager} {session.platform.secretsPersistent ? <Pill tone="success">persistente</Pill> : <Pill tone="warning">non persistente</Pill>}
            </Field>
          </dl>
          <p className="text-xs text-muted-foreground">
            Le credenziali sono cifrate lato server (AES-256-GCM) e referenziate tramite riferimenti opachi. Non vengono mai restituite al browser né scritte nei log.
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-label="Ambienti">
        <h2 className="text-sm font-semibold">Ambienti</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {session.environments.map((env) => (
            <EnvironmentCard key={env.environmentId} env={env} selected={env.environmentId === selectedId} />
          ))}
        </div>
      </section>

      {session.settings ? <AppSettingsForm key={JSON.stringify(session.settings)} settings={session.settings} /> : <SimulatedNotice>Inizializza l&apos;ambiente per configurare i parametri applicativi.</SimulatedNotice>}
    </div>
  )
}

function StatusLine({ ok, label, message }: { ok: boolean | null; label: string; message: string | null }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok === null ? <span className="mt-0.5 size-3.5 rounded-full border" aria-hidden /> : ok ? <CheckCircle2 className="mt-0.5 size-3.5 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-3.5 text-destructive" aria-hidden />}
      <span>
        <span className="font-medium">{label}</span>
        {message ? <span className="text-muted-foreground"> — {message}</span> : null}
      </span>
    </div>
  )
}

function EnvironmentCard({ env, selected }: { env: PublicEnvironment; selected: boolean }) {
  const { reload, can } = useSession()
  const [busy, setBusy] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const isAdmin = can('admin')

  async function run(action: string, fn: () => Promise<unknown>, success: string) {
    setBusy(action)
    try {
      const res = (await fn()) as { ok?: boolean; message?: string } | undefined
      if (res && res.ok === false) toast.error(res.message ?? 'Operazione non riuscita')
      else toast.success(res?.message ?? success)
      await reload()
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const mongoOk = env.status.mongo === 'CONNECTED' ? true : env.status.mongo === 'ERROR' ? false : null
  const voyageOk = env.status.voyage === 'CONNECTED' ? true : env.status.voyage === 'ERROR' ? false : null

  return (
    <Card className={selected ? 'border-primary ring-1 ring-primary/30' : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            {env.mongo ? <Database className="size-4 text-primary" aria-hidden /> : <Server className="size-4 text-muted-foreground" aria-hidden />}
            {env.name}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            <Mono>{env.environmentId}</Mono> · {env.type}
          </span>
        </div>
        {selected ? <Pill tone="brand">Attivo</Pill> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Dati">{env.mongo ? `MongoDB · ${env.mongo.databaseName}` : 'Simulatore in-memory'}</Field>
          <Field label="Host">{env.mongo?.host ?? '—'}</Field>
          <Field label="Credenziali">{env.mongo ? (env.mongo.hasCredentials ? `Salvate (${env.mongo.credentialSource})` : 'Revocate') : 'Non richieste'}</Field>
          <Field label="Voyage AI">
            {env.voyage.mode} · {env.voyage.model}
            {env.voyage.mode === 'voyage-api' ? (env.voyage.hasApiKey ? ' · key salvata' : ' · key mancante') : ''}
          </Field>
          <Field label="Inizializzato">{fmtDateTime(env.status.initializedAt)}</Field>
          <Field label="Vector index">
            <StatusBadge status={env.status.vectorIndex} />
          </Field>
        </dl>
        <div className="flex flex-col gap-1.5">
          {env.mongo && <StatusLine ok={mongoOk} label={`MongoDB: ${env.status.mongo}`} message={env.status.mongoMessage} />}
          <StatusLine ok={env.voyage.mode === 'simulated' ? null : voyageOk} label={`Voyage AI: ${env.voyage.mode === 'simulated' ? 'simulato' : env.status.voyage}`} message={env.status.voyageMessage} />
          {env.status.vectorIndexMessage && <StatusLine ok={env.status.vectorIndex === 'READY'} label="Vector Search" message={env.status.vectorIndexMessage} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {!selected && (
            <Button size="sm" disabled={!!busy} onClick={() => run('select', () => apiSend('/api/environments/select', { environmentId: env.environmentId }), `Ambiente “${env.name}” attivato`)}>
              {busy === 'select' && <Spinner />}
              Attiva
            </Button>
          )}
          {isAdmin && env.mongo && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('mongo', () => apiSend('/api/integrations/mongodb/test', { environmentId: env.environmentId }), 'Connessione MongoDB verificata')}>
              {busy === 'mongo' && <Spinner />}
              Test MongoDB
            </Button>
          )}
          {isAdmin && env.voyage.mode !== 'simulated' && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('voyage', () => apiSend('/api/integrations/voyage/test', { environmentId: env.environmentId }), 'Voyage AI verificato')}>
              {busy === 'voyage' && <Spinner />}
              Test Voyage AI
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => run('init', () => apiSend('/api/setup/initialize', { environmentId: env.environmentId, reseed: false }), 'Ambiente inizializzato')}
            >
              {busy === 'init' && <Spinner />}
              Inizializza
            </Button>
          )}
          {isAdmin && !env.builtIn && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={!!busy}
              onClick={() => {
                if (window.confirm(`Eliminare l'ambiente “${env.name}” e revocare i segreti associati? I dati nel database non verranno toccati.`))
                  run('delete', () => apiSend(`/api/environments/${env.environmentId}`, undefined, 'DELETE'), 'Ambiente eliminato e segreti revocati')
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Elimina
            </Button>
          )}
        </div>
        {isAdmin && !env.builtIn && env.voyage.mode === 'voyage-api' && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <Label htmlFor={`key-${env.environmentId}`} className="flex items-center gap-1.5 text-xs">
              <KeyRound className="size-3.5" aria-hidden />
              Sostituisci o revoca API key Voyage AI
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`key-${env.environmentId}`}
                type="password"
                autoComplete="off"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Nuova API key (non verrà mostrata di nuovo)"
                className="h-8 min-w-56 flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy || newKey.length < 10}
                onClick={() =>
                  run(
                    'key',
                    async () => {
                      const r = await apiSend(`/api/environments/${env.environmentId}`, { voyage: { mode: 'voyage-api', apiKey: newKey } }, 'PATCH')
                      setNewKey('')
                      return r
                    },
                    'API key sostituita',
                  )
                }
              >
                Sostituisci
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={!!busy || !env.voyage.hasApiKey}
                onClick={() => run('revoke', () => apiSend(`/api/environments/${env.environmentId}`, { voyage: { mode: 'voyage-api' }, revokeVoyageKey: true }, 'PATCH'), 'API key revocata')}
              >
                Revoca
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const APPROVAL_LABELS: Record<string, string> = {
  CLAIMS_REPORT: 'Report sinistri',
  ACCESS_PROVISIONING: 'Abilitazione accessi',
  POLICY_DOCUMENT_RETRIEVAL: 'Copia polizza',
  CUSTOMER_DATA_UPDATE: 'Aggiornamento dati cliente',
  PAYMENT_REPORT: 'Report pagamenti',
  COMPLIANCE_REQUEST: 'Richieste compliance',
}

function AppSettingsForm({ settings }: { settings: AppSettings }) {
  const { can, reload, session } = useSession()
  const isAdmin = can('admin')
  const [s, setS] = useState(settings)
  const [saving, setSaving] = useState(false)
  const agencies = session?.environments ? null : null
  void agencies

  async function save() {
    setSaving(true)
    try {
      const { key: _key, ...patch } = s
      void _key
      await apiSend('/api/settings', patch, 'PATCH')
      toast.success('Impostazioni salvate')
      await reload()
      refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" aria-hidden />
          Parametri applicativi
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <fieldset disabled={!isAdmin || saving} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label>Velocità di simulazione</Label>
            <FilterSelect
              label="Velocità"
              value={s.simulationSpeed}
              onChange={(v) => setS({ ...s, simulationSpeed: v as AppSettings['simulationSpeed'] })}
              options={[
                { value: 'instant', label: 'Instant' },
                { value: 'fast', label: 'Fast' },
                { value: 'normal', label: 'Normal' },
                { value: 'slow', label: 'Slow' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="def-agency">Agenzia predefinita</Label>
            <Input id="def-agency" value={s.defaultAgencyId} onChange={(e) => setS({ ...s, defaultAgencyId: e.target.value.toUpperCase() })} maxLength={10} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Dimensione dataset demo</Label>
            <FilterSelect
              label="Dataset"
              value={s.datasetSize}
              onChange={(v) => setS({ ...s, datasetSize: v as AppSettings['datasetSize'] })}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Classificazione automatica</span>
              <span className="text-xs text-muted-foreground">Classifica i ticket al consumo dell&apos;evento</span>
            </span>
            <Switch checked={s.autoClassification} onCheckedChange={(v) => setS({ ...s, autoClassification: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Failure injection</span>
              <span className="text-xs text-muted-foreground">Il prossimo step di generazione fallirà</span>
            </span>
            <Switch checked={s.injectFailureNext} onCheckedChange={(v) => setS({ ...s, injectFailureNext: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Simulazione in pausa</span>
              <span className="text-xs text-muted-foreground">Sospende l&apos;avanzamento dei tick</span>
            </span>
            <Switch checked={s.paused} onCheckedChange={(v) => setS({ ...s, paused: v })} />
          </label>
        </fieldset>

        <fieldset disabled={!isAdmin || saving} className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Policy di approvazione Human-in-the-Loop</legend>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries({ ...Object.fromEntries(Object.keys(APPROVAL_LABELS).map((k) => [k, false])), ...s.approvalPolicies }).map(([k, v]) => (
              <label key={k} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-sm">{APPROVAL_LABELS[k] ?? k}</span>
                <Switch checked={v} onCheckedChange={(nv) => setS({ ...s, approvalPolicies: { ...s.approvalPolicies, [k]: nv } })} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={!isAdmin || saving} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Policy decisionale di classificazione</legend>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-top">Similarità minima top match</Label>
              <Input
                id="min-top"
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={s.decisionPolicy.minTopScore}
                onChange={(e) => setS({ ...s, decisionPolicy: { ...s.decisionPolicy, minTopScore: Number(e.target.value) } })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-margin">Margine minimo tra categorie</Label>
              <Input
                id="min-margin"
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={s.decisionPolicy.minMargin}
                onChange={(e) => setS({ ...s, decisionPolicy: { ...s.decisionPolicy, minMargin: Number(e.target.value) } })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="top-k">Top K</Label>
              <Input id="top-k" type="number" min={1} max={20} value={s.decisionPolicy.topK} onChange={(e) => setS({ ...s, decisionPolicy: { ...s.decisionPolicy, topK: Number(e.target.value) } })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Sotto soglia o con margine insufficiente il ticket entra in Manual Triage.</p>
        </fieldset>

        {!isAdmin && <p className="text-xs text-muted-foreground">Solo il ruolo admin può modificare le impostazioni.</p>}
        <div>
          <Button onClick={save} disabled={!isAdmin || saving}>
            {saving ? <Spinner /> : <Save className="size-4" aria-hidden />}
            Salva impostazioni
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
