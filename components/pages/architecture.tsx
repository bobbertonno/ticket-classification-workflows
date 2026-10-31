'use client'

import { useState } from 'react'
import { ArrowRight, MousePointerClick } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArchitectureDiagram } from '@/components/console/architecture-diagram'
import { Mono, PageHeader, Pill, SectionTitle } from '@/components/console/kit'
import { cn } from '@/lib/utils'
import { ATLAS_FEATURES, FLOW_STEPS, type AtlasFeature, type FeatureId } from './architecture-data'

export function ArchitecturePage() {
  const [selected, setSelected] = useState<FeatureId>('vector-search')
  const feature = ATLAS_FEATURES.find((f) => f.id === selected)!

  const select = (id: FeatureId) => {
    setSelected(id)
    document.getElementById('feature-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Architettura della piattaforma"
        description="Come MongoDB Atlas fa da sistema centrale: stato dei workflow, idempotenza, event log, ricerca semantica e audit in un unico cluster."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Diagramma architetturale</CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointerClick className="size-3.5" aria-hidden />
            Clicca una funzionalità di Atlas per il dettaglio
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ArchitectureDiagram selected={selected} onSelect={select} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <Legend className="border-primary/40 bg-accent" label="Applicazione (Next.js su Vercel, serverless)" />
            <Legend className="border-success/50 bg-success/10" label="MongoDB Atlas" />
            <Legend className="border-info/40 bg-info/10" label="Voyage AI" />
            <Legend className="border-border bg-muted" label="Sistemi esterni (simulati in Demo Mode)" />
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="flow-title" className="flex flex-col gap-3">
        <SectionTitle>
          <span id="flow-title">Il ciclo di vita di un ticket, visto da Atlas</span>
        </SectionTitle>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {FLOW_STEPS.map((s, i) => {
            const f = ATLAS_FEATURES.find((x) => x.id === s.feature)!
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => select(s.feature)}
                  className={cn(
                    'flex h-full w-full flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:border-success/50',
                    selected === s.feature && 'border-success ring-2 ring-success/20',
                  )}
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{i + 1}</span>
                    {f.title}
                  </span>
                  <span className="text-sm font-medium text-foreground">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{s.detail}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <nav aria-label="Funzionalità MongoDB Atlas" className="flex flex-col gap-1">
          <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Funzionalità Atlas utilizzate</p>
          {ATLAS_FEATURES.map((f) => {
            const Icon = f.icon
            const active = f.id === selected
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => select(f.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  active ? 'bg-success/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-success" />}
                <Icon className={cn('size-4 shrink-0', active && 'text-success')} aria-hidden />
                <span className="truncate">{f.title}</span>
              </button>
            )
          })}
        </nav>
        <FeatureDetail feature={feature} />
      </div>
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn('size-3 rounded-sm border', className)} />
      {label}
    </span>
  )
}

function FeatureDetail({ feature }: { feature: AtlasFeature }) {
  const Icon = feature.icon
  return (
    <Card id="feature-detail" className="scroll-mt-24">
      <CardHeader className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="text-lg">{feature.title}</CardTitle>
            <Pill tone="success" className="w-fit">
              {feature.atlasCapability}
            </Pill>
          </div>
        </div>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{feature.summary}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Come la usa il Control Center</h3>
          <ul className="flex flex-col gap-2">
            {feature.usage.map((u) => (
              <li key={u} className="flex gap-2 text-sm leading-relaxed text-foreground">
                <ArrowRight className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden />
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border-l-[3px] border-primary bg-accent/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Perché è centrale</p>
          <p className="mt-1 text-pretty text-sm leading-relaxed text-foreground">{feature.centrality}</p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Esempio dal codice</h3>
          <pre className="overflow-x-auto rounded-lg border bg-[#1F2430] p-4 font-mono text-xs leading-relaxed text-[#E6E8EC]">
            <code>{feature.snippet}</code>
          </pre>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          {feature.collections.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              Collezioni:
              {feature.collections.map((c) => (
                <Mono key={c} className="rounded bg-muted px-1.5 py-0.5">
                  {c}
                </Mono>
              ))}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            Implementazione: <Mono>{feature.sourceFile}</Mono>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
