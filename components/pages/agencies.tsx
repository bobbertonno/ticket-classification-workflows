'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Donut, GroupedBars, HorizontalBars } from '@/components/console/charts'
import { EmptyState, ErrorState, Field, KpiCard, LoadingBlock, Mono, PageHeader, SimulatedNotice, StatusBadge } from '@/components/console/kit'
import { fetcher } from '@/lib/client/api'
import { fmtMinutes, fmtPct } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import type { RemedyTicket } from '@/lib/domain/schemas'

interface AgencyRow {
  agencyId: string
  agencyName: string
  region: string
  city: string
  geographicArea: string
  operatorName: string
  status: string
  totalTickets: number
  completed: number
  failed: number
  open: number
  automationRate: number | null
  humanInterventionRate: number | null
  avgResolutionMin: number | null
  slaCompliance: number | null
  topCategories: { category: string; label: string; count: number }[]
  categories: Record<string, number>
}

export function AgenciesPage() {
  const { data, error, isLoading, mutate } = useSWR<{ agencies: AgencyRow[]; regions: { area: string; tickets: number; completed: number; failed: number }[] }>('/api/analytics/agencies', fetcher, {
    refreshInterval: 4000,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />
  if (isLoading || !data) return <LoadingBlock rows={8} />
  const { agencies, regions } = data
  if (!agencies.length) return <EmptyState icon={Building2} title="Nessuna agenzia" />
  const selected = agencies.find((a) => a.agencyId === selectedId) ?? agencies[0]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Performance agenzie" description="Analisi operative per agenzia di origine, calcolate dallo stato corrente dei ticket e delle esecuzioni." />
      <SimulatedNotice>Le agenzie sono record sintetici di demo; i dati non rappresentano agenzie Generali reali.</SimulatedNotice>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Volume ticket per agenzia</CardTitle>
          </CardHeader>
          <CardContent>
            <GroupedBars
              data={agencies.map((a) => ({ label: a.agencyId, completed: a.completed, open: a.open, failed: a.failed }))}
              labelKey="label"
              series={[
                { key: 'completed', name: 'Completati', color: '#16803C' },
                { key: 'open', name: 'Aperti', color: '#2563EB' },
                { key: 'failed', name: 'Falliti/escalati', color: '#D92D20' },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ripartizione per area</CardTitle>
          </CardHeader>
          <CardContent>
            <Donut data={regions} nameKey="area" dataKey="tickets" />
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Agenzia</TableHead>
                <TableHead>Regione</TableHead>
                <TableHead className="text-right">Ticket</TableHead>
                <TableHead className="text-right">Completati</TableHead>
                <TableHead className="text-right">Falliti</TableHead>
                <TableHead className="text-right">Automazione</TableHead>
                <TableHead className="text-right">Intervento umano</TableHead>
                <TableHead className="text-right">Risoluzione media</TableHead>
                <TableHead className="text-right">SLA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agencies.map((a, i) => (
                <TableRow key={a.agencyId} onClick={() => setSelectedId(a.agencyId)} className={cn('cursor-pointer', a.agencyId === selected.agencyId && 'bg-accent/40')}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell>
                    <button type="button" className="flex flex-col text-left" onClick={() => setSelectedId(a.agencyId)}>
                      <Mono>{a.agencyId}</Mono>
                      <span className="text-xs text-muted-foreground">{a.agencyName}</span>
                    </button>
                  </TableCell>
                  <TableCell className="text-xs">{a.region}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.totalTickets}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.completed}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.failed}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(a.automationRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(a.humanInterventionRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMinutes(a.avgResolutionMin)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(a.slaCompliance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AgencyDetail agency={selected} />
    </div>
  )
}

function AgencyDetail({ agency }: { agency: AgencyRow }) {
  const { data } = useSWR<{ tickets: RemedyTicket[] }>(`/api/tickets?agencyId=${agency.agencyId}`, fetcher, { refreshInterval: 5000 })
  const cats = Object.entries(agency.categories)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)

  return (
    <section className="flex flex-col gap-4" aria-label={`Dettaglio ${agency.agencyName}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {agency.agencyId} — {agency.agencyName}
        </h2>
        <StatusBadge status={agency.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Ticket totali" value={agency.totalTickets} />
        <KpiCard label="Tasso di automazione" value={fmtPct(agency.automationRate)} tone="success" />
        <KpiCard label="Risoluzione media" value={fmtMinutes(agency.avgResolutionMin)} />
        <KpiCard label="SLA compliance" value={fmtPct(agency.slaCompliance)} tone="info" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Anagrafica</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Città">{agency.city}</Field>
              <Field label="Regione">{agency.region}</Field>
              <Field label="Area">{agency.geographicArea}</Field>
              <Field label="Referente">{agency.operatorName}</Field>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Categorie più richieste</CardTitle>
          </CardHeader>
          <CardContent>{cats.length ? <HorizontalBars data={cats} dataKey="count" labelKey="category" name="Ticket" height={200} /> : <p className="text-sm text-muted-foreground">Nessun dato.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ticket recenti</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {(data?.tickets ?? []).slice(0, 6).map((t) => (
              <Link key={t.ticketId} href={`/tickets/${t.ticketId}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-muted/50">
                <span className="min-w-0 truncate text-xs">{t.subject}</span>
                <StatusBadge status={t.status} />
              </Link>
            ))}
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/tickets?agency=${agency.agencyId}`} />}>
              Tutti i ticket
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
