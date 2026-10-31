'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { FlaskConical, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorState, Field, FilterSelect, JsonBlock, LoadingBlock, Mono, PageHeader, Pill, SimulatedNotice, Spinner } from '@/components/console/kit'
import { useSession } from '@/components/console/session-provider'
import { apiSend, fetcher } from '@/lib/client/api'
import { fmtDateTime, METHOD_LABELS } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { CATEGORY_LABELS } from '@/lib/domain/seed-data'
import type { Agency, Category, ClassificationResult, RemedyTicket, SemanticMatch } from '@/lib/domain/schemas'

interface Comparison {
  keyword: { category: Category; matchedKeywords: string[]; scores: { category: Category; score: number }[] }
  semantic: { category: Category; rule: string; matches: SemanticMatch[]; method: string; simulated: boolean; modelName: string; fallbackReason: string | null }
  hybrid: { category: Category; scores: { category: Category; score: number }[]; rule: string }
}

const PARAPHRASES = [
  'Mi serve un Excel con tutti i sinistri aperti a settembre 2026 per la mia agenzia.',
  'Potreste estrarmi in un foglio di calcolo le pratiche di danno ancora in lavorazione del mese scorso?',
  "Vorrei l'elenco dei claim non ancora liquidati, in formato xlsx, per il nostro punto vendita.",
  'Ho bisogno della copia PDF della polizza 987654.',
  'Il cliente ha perso il contratto assicurativo n. 987654, potete rimandarmi il documento?',
]

function ScoreBars({ items }: { items: { label: string; sub?: string; score: number; highlight?: boolean }[] }) {
  const max = Math.max(0.0001, ...items.map((i) => i.score))
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((i, idx) => (
        <li key={`${i.label}-${idx}`} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className={cn('min-w-0 truncate', i.highlight && 'font-medium')}>{i.label}</span>
            <span className="shrink-0 font-mono tabular-nums">{i.score.toFixed(3)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className={cn('h-full rounded-full', i.highlight ? 'bg-primary' : 'bg-primary/35')} style={{ width: `${Math.max(2, (i.score / max) * 100)}%` }} />
          </div>
          {i.sub && <span className="line-clamp-1 text-[11px] text-muted-foreground">{i.sub}</span>}
        </li>
      ))}
    </ul>
  )
}

export function ClassificationPage() {
  const router = useRouter()
  const search = useSearchParams()
  const { data: tickets } = useSWR<{ tickets: RemedyTicket[] }>('/api/tickets', fetcher, { refreshInterval: 5000 })
  const { session } = useSession()
  const integration = session?.integration
  const classified = (tickets?.tickets ?? []).filter((t) => t.category)
  const list = [...classified.filter((t) => !t.seeded), ...classified.filter((t) => t.seeded)]
  const ticketId = search.get('ticket') ?? list[0]?.ticketId ?? null
  const provider = integration?.classification

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Classificazione semantica" description="Voyage AI + MongoDB Atlas Vector Search: retrieval di esempi semanticamente simili e regole decisionali deterministiche." />
      {provider && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <span className="text-muted-foreground">Provider attivo per le nuove classificazioni:</span>
          <Pill tone={provider.simulated ? 'warning' : 'success'}>{METHOD_LABELS[provider.method] ?? provider.method}</Pill>
          <Mono>{provider.modelName}</Mono>
          <span className="w-full text-xs text-muted-foreground">{provider.description}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Ticket</span>
        <FilterSelect
          label="Ticket"
          value={ticketId ?? ''}
          onChange={(v) => router.replace(`/classification?ticket=${v}`, { scroll: false })}
          options={list.slice(0, 80).map((t) => ({ value: t.ticketId, label: `${t.seeded ? '[storico] ' : ''}${t.ticketId} · ${t.agencyId} · ${t.subject.slice(0, 50)}` }))}
        />
      </div>
      {ticketId ? <TicketClassification ticketId={ticketId} /> : <EmptyState icon={Sparkles} title="Nessun ticket classificato" description="Pubblica un evento dal Kafka Simulator." />}
      <ComparisonLab />
    </div>
  )
}

function TicketClassification({ ticketId }: { ticketId: string }) {
  const { data, error, isLoading, mutate } = useSWR<{ ticket: RemedyTicket; agency: Agency | null; classification: ClassificationResult | null }>(`/api/classification/${ticketId}`, fetcher, {
    refreshInterval: 3000,
  })
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (isLoading || !data) return <LoadingBlock rows={6} />
  const { ticket, agency, classification: c } = data
  if (!c) return <EmptyState title="Classificazione in corso" description="Il risultato apparirà al prossimo tick dell'engine." />

  return (
    <div className="flex flex-col gap-4">
      {c.simulated &&
        (ticket.seeded ? (
          <SimulatedNotice>
            Ticket storico sintetico pre-caricato dal dataset demo: la sua categoria è stata assegnata al caricamento, senza classificazione semantica. Pubblica un nuovo evento dal Kafka Simulator per vedere i risultati del provider attivo.
          </SimulatedNotice>
        ) : (
          <SimulatedNotice>
            Punteggi prodotti dal classificatore deterministico simulato (nessuna chiamata a Voyage AI).{' '}
            {c.fallbackReason ? `Motivo: ${c.fallbackReason}` : 'Il ticket è stato classificato mentre l’ambiente era in modalità simulata.'}
          </SimulatedNotice>
        ))}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Richiesta originale</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium">{ticket.subject}</p>
            <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">{ticket.description}</p>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Testo normalizzato</span>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{c.normalizedText}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Decisione</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3">
              <Field label="Agenzia (metadati autoritativi)">
                {agency ? `${agency.agencyId} — ${agency.agencyName}` : ticket.agencyId}
              </Field>
              <Field label="Categoria selezionata">
                <Pill tone={c.selectedCategory === 'UNKNOWN' ? 'warning' : 'brand'}>{CATEGORY_LABELS[c.selectedCategory]}</Pill>
              </Field>
              <Field label="Workflow selezionato">
                <Mono>{c.selectedWorkflow}</Mono>
              </Field>
              <Field label="Metodo">{METHOD_LABELS[c.method] ?? c.method}</Field>
              <Field label="Modello di embedding">
                {c.modelName}
                {c.rerankModel ? ` · rerank ${c.rerankModel}` : ''}
              </Field>
              <Field label="Regola decisionale">
                <span className="text-xs">{c.decisionRule}</span>
              </Field>
              <Field label="Revisione umana">{c.humanReviewRequired ? <Pill tone="warning">Manual triage richiesto</Pill> : <Pill tone="success">Non richiesta</Pill>}</Field>
              <Field label="Classificato">{fmtDateTime(c.classificationTimestamp)}</Field>
            </dl>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Top match semantici</CardTitle>
            <p className="text-xs text-muted-foreground">Similarità coseno grezza tra embedding: non è una probabilità calibrata.</p>
          </CardHeader>
          <CardContent>
            <ScoreBars
              items={c.semanticMatches.map((m, i) => ({
                label: `${CATEGORY_LABELS[m.category]} · ${m.subcategory}`,
                sub: `“${m.exampleRequest}”${m.rerankScore !== undefined ? ` · rerank ${m.rerankScore.toFixed(3)}` : ''}`,
                score: m.score,
                highlight: i === 0,
              }))}
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Punteggi per categoria</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreBars items={c.categoryScores.slice(0, 5).map((s, i) => ({ label: CATEGORY_LABELS[s.category], score: s.score, highlight: i === 0 }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Parametri estratti e policy</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <JsonBlock value={c.extractedParameters} />
              <div className="text-xs">
                <span className="font-medium">{c.policyDecision.authorized ? 'Autorizzato' : 'Non autorizzato'}</span>
                {c.policyDecision.approvalRequired ? ' · approvazione richiesta' : ''}
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {c.policyDecision.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ComparisonLab() {
  const [text, setText] = useState(PARAPHRASES[1])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ comparison: Comparison; integration: { simulated: boolean; description: string } } | null>(null)

  async function run() {
    setBusy(true)
    try {
      setResult(await apiSend('/api/classification/classify', { text }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cmp = result?.comparison
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FlaskConical className="size-4 text-primary" aria-hidden />
          Confronto metodi: Keyword vs Voyage AI vs Hybrid
        </CardTitle>
        <p className="text-xs text-muted-foreground">Scrivi la stessa richiesta con parole diverse: il retrieval semantico riconosce l&apos;intento anche senza parole chiave in comune.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {PARAPHRASES.map((p) => (
            <Button key={p} size="xs" variant="outline" onClick={() => setText(p)} className="max-w-xs truncate">
              {p.slice(0, 48)}…
            </Button>
          ))}
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Richiesta da classificare" maxLength={2000} />
        <div>
          <Button onClick={run} disabled={busy || text.trim().length < 5}>
            {busy ? <Spinner /> : <Sparkles className="size-4" aria-hidden />}
            Confronta
          </Button>
        </div>
        {cmp && (
          <>
            {cmp.semantic.simulated && <SimulatedNotice>Risultato semantico simulato: {cmp.semantic.fallbackReason ?? result?.integration.description}</SimulatedNotice>}
            <div className="grid gap-4 md:grid-cols-3">
              <MethodCard title="Keyword" category={cmp.keyword.category} note={cmp.keyword.matchedKeywords.length ? `Parole chiave: ${cmp.keyword.matchedKeywords.join(', ')}` : 'Nessuna parola chiave trovata'}>
                <ScoreBars items={cmp.keyword.scores.map((s, i) => ({ label: CATEGORY_LABELS[s.category], score: s.score, highlight: i === 0 }))} />
              </MethodCard>
              <MethodCard title={`Semantica · ${cmp.semantic.modelName}`} category={cmp.semantic.category} note={cmp.semantic.rule}>
                <ScoreBars items={cmp.semantic.matches.slice(0, 5).map((m, i) => ({ label: CATEGORY_LABELS[m.category], sub: m.exampleRequest, score: m.score, highlight: i === 0 }))} />
              </MethodCard>
              <MethodCard title="Hybrid (0.7 semantica + 0.3 keyword)" category={cmp.hybrid.category} note={cmp.hybrid.rule}>
                <ScoreBars items={cmp.hybrid.scores.slice(0, 5).map((s, i) => ({ label: CATEGORY_LABELS[s.category], score: s.score, highlight: i === 0 }))} />
              </MethodCard>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MethodCard({ title, category, note, children }: { title: string; category: Category; note: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Pill tone={category === 'UNKNOWN' ? 'warning' : 'brand'} className="w-fit">
          {CATEGORY_LABELS[category]}
        </Pill>
        <span className="text-[11px] text-muted-foreground">{note}</span>
      </div>
      {children}
    </div>
  )
}
