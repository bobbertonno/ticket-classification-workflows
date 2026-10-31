'use client'

import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, FlaskConical, Inbox, Loader2 } from 'lucide-react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fetcher } from '@/lib/client/api'
import { STATUS_LABELS, STATUS_TONE, type Tone } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import type { Agency } from '@/lib/domain/schemas'

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/12 text-[#8a5f0d] border-warning/30',
  error: 'bg-destructive/10 text-destructive border-destructive/25',
  info: 'bg-info/10 text-info border-info/25',
  brand: 'bg-accent text-accent-foreground border-primary/25',
  neutral: 'bg-muted text-muted-foreground border-border',
}

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CLASSES[tone], className)}>
      {children}
    </span>
  )
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral'
  const live = status === 'RUNNING' || status === 'RETRYING' || status === 'CLASSIFYING'
  return (
    <Pill tone={tone} className={className}>
      <span className={cn('size-1.5 rounded-full bg-current', live && 'animate-pulse')} aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </Pill>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-pretty text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="max-w-3xl text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: LucideIcon
  tone?: Tone
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {Icon && (
            <span className={cn('flex size-7 items-center justify-center rounded-md border', TONE_CLASSES[tone])}>
              <Icon className="size-3.5" aria-hidden />
            </span>
          )}
        </div>
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  )
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-6 py-10 text-center">
      <Icon className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="size-4" aria-hidden />
        Impossibile caricare i dati
      </div>
      <p className="text-sm text-foreground">{error.message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Riprova
        </Button>
      )}
    </div>
  )
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Caricamento">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
}

export function SimulatedNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs leading-relaxed text-[#6b4a0a]">
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  )
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs', className)}>{children}</span>
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn('max-h-72 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed', className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export interface Option {
  value: string
  label: string
}

export function FilterSelect({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: Option[]
  label: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange((v as string | null) ?? 'all')} items={options}>
      <SelectTrigger aria-label={label} className={cn('h-9 min-w-40 bg-card', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function useAgencies() {
  return useSWR<{ agencies: Agency[] }>('/api/agencies', fetcher)
}

export function AgencyFilter({ value, onChange, allLabel = 'Tutte le agenzie' }: { value: string; onChange: (v: string) => void; allLabel?: string }) {
  const { data } = useAgencies()
  const options: Option[] = [{ value: 'all', label: allLabel }, ...(data?.agencies ?? []).map((a) => ({ value: a.agencyId, label: `${a.agencyId} — ${a.agencyName}` }))]
  return <FilterSelect value={value} onChange={onChange} options={options} label="Agenzia" className="min-w-56" />
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
      {action}
    </div>
  )
}
