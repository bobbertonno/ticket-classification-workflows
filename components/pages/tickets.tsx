'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { Search, Ticket } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AgencyFilter, EmptyState, ErrorState, FilterSelect, LoadingBlock, Mono, PageHeader, Pill, StatusBadge } from '@/components/console/kit'
import { fetcher, qs } from '@/lib/client/api'
import { fmtDateTime, PRIORITY_LABELS } from '@/lib/client/format'
import { CATEGORY_LABELS } from '@/lib/domain/seed-data'
import type { RemedyTicket } from '@/lib/domain/schemas'

const STATUSES = ['NEW', 'CLASSIFYING', 'CLASSIFIED', 'IN_PROGRESS', 'WAITING_FOR_APPROVAL', 'RESOLVED', 'CLOSED', 'FAILED', 'ESCALATED']

export const priorityTone = (p: string) => (p === 'CRITICAL' ? 'error' : p === 'HIGH' ? 'warning' : p === 'MEDIUM' ? 'info' : 'neutral') as 'error' | 'warning' | 'info' | 'neutral'

export function TicketsPage() {
  const search = useSearchParams()
  const [agencyId, setAgencyId] = useState(search.get('agency') ?? 'all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const { data, error, isLoading, mutate } = useSWR<{ tickets: RemedyTicket[] }>(`/api/tickets${qs({ agencyId, status, q: q.trim() || undefined })}`, fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true,
  })
  const tickets = data?.tickets ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Remedy Tickets" description="Ticket BMC Remedy (simulati) aperti dalle agenzie. Lo stato è aggiornato automaticamente dall'esecuzione dei workflow." />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca ID, oggetto, operatore…" className="h-9 w-72 bg-card pl-8" aria-label="Cerca ticket" />
        </div>
        <AgencyFilter value={agencyId} onChange={setAgencyId} />
        <FilterSelect label="Stato" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Tutti gli stati' }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
        <span className="ml-auto text-xs text-muted-foreground">{tickets.length} ticket</span>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock rows={8} />
      ) : tickets.length === 0 ? (
        <EmptyState icon={Ticket} title="Nessun ticket" description="Pubblica un evento remedy.ticket.created dal Kafka Simulator per creare un ticket." />
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Agenzia</TableHead>
                  <TableHead className="min-w-64">Oggetto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Priorità</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Aggiornato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.ticketId}>
                    <TableCell>
                      <Link href={`/tickets/${t.ticketId}`} className="font-mono text-xs font-medium text-primary hover:underline">
                        {t.ticketId}
                      </Link>
                      {t.seeded && <span className="ml-2 text-[10px] text-muted-foreground">storico</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <Mono>{t.agencyId}</Mono>
                        <span className="text-xs text-muted-foreground">{t.agencyName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-sm">{t.subject}</TableCell>
                    <TableCell className="text-xs">{t.category ? CATEGORY_LABELS[t.category] : '—'}</TableCell>
                    <TableCell>
                      <Pill tone={priorityTone(t.priority)}>{PRIORITY_LABELS[t.priority]}</Pill>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{fmtDateTime(t.updatedAt)}</TableCell>
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
