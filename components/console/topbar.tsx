'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Bell, ChevronDown, Database, Menu, ServerCog, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { apiSend, fetcher, refreshAll } from '@/lib/client/api'
import { fmtTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { Brand } from './brand'
import { useSession } from './session-provider'
import { SidebarNav } from './sidebar'

function ConnectionStatus() {
  const { session, error } = useSession()
  const integ = session?.integration
  let tone = 'bg-muted-foreground'
  let label = 'Verifica…'
  if (error || session?.contextError) {
    tone = 'bg-destructive'
    label = session?.contextError?.code === 'NOT_INITIALIZED' ? 'Da inizializzare' : 'Non disponibile'
  } else if (integ) {
    tone = integ.dataProvider === 'mongodb' ? 'bg-success' : 'bg-warning'
    label = integ.dataProvider === 'mongodb' ? 'MongoDB connesso' : 'Simulatore in-memory'
  }
  return (
    <div className="hidden items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs md:flex" title={session?.contextError?.message ?? integ?.dataLabel}>
      <span className={cn('size-2 rounded-full', tone)} aria-hidden />
      <Database className="size-3.5 text-muted-foreground" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

function EnvironmentSwitcher() {
  const { session, reload, can } = useSession()
  const current = session?.integration?.environmentId ?? session?.environments[0]?.environmentId
  const currentEnv = session?.environments.find((e) => e.environmentId === current)

  async function select(environmentId: string) {
    try {
      await apiSend('/api/environments/select', { environmentId })
      await reload()
      await refreshAll()
      toast.success('Ambiente selezionato')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
        <ServerCog className="size-4" aria-hidden />
        <span className="max-w-40 truncate">{currentEnv?.name ?? 'Ambiente'}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Ambienti disponibili</DropdownMenuLabel>
          {session?.environments.map((e) => (
            <DropdownMenuItem key={e.environmentId} onClick={() => select(e.environmentId)} className="flex flex-col items-start gap-0.5">
              <span className={cn('text-sm', e.environmentId === current && 'font-semibold text-primary')}>{e.name}</span>
              <span className="text-xs text-muted-foreground">
                {e.type === 'DEMO' ? 'Simulatore in-memory' : `MongoDB · ${e.mongo?.databaseName ?? '—'}`} · {e.status.initializedAt ? 'inizializzato' : 'non inizializzato'}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {can('admin') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings/setup" />}>Configura nuovo ambiente…</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { session, reload } = useSession()
  async function switchUser(userId: string) {
    try {
      await apiSend('/api/session', { userId })
      await reload()
      await refreshAll()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const actor = session?.actor
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-2" />}>
        <span className="flex size-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="hidden flex-col items-start leading-tight md:flex">
          <span className="text-xs font-medium">{actor?.name ?? '…'}</span>
          <span className="text-[10px] text-muted-foreground">{actor?.role}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Utente demo (persona)</DropdownMenuLabel>
          {session?.personas.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => switchUser(p.id)} className="flex flex-col items-start gap-0.5">
              <span className={cn('text-sm', p.id === actor?.id && 'font-semibold text-primary')}>
                {p.name} · {p.role}
              </span>
              <span className="text-xs text-muted-foreground">{p.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface NotificationItem {
  notificationId: string
  subject: string
  agencyName: string
  channel: string
  timestamp: string
}

function NotificationBell() {
  const { session } = useSession()
  const ready = Boolean(session?.integration && !session.contextError)
  const { data } = useSWR<{ notifications: NotificationItem[] }>(ready ? '/api/notifications' : null, fetcher, { refreshInterval: 5000 })
  const [seen, setSeen] = useState<string | null>(null)
  const items = data?.notifications.slice(0, 6) ?? []
  const latest = items[0]?.timestamp ?? null
  const unread = latest !== null && latest !== seen ? items.filter((n) => !seen || n.timestamp > seen).length : 0

  return (
    <DropdownMenu onOpenChange={(open) => open && setSeen(latest)}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label="Notifiche simulate" />}>
        <Bell className="size-4" aria-hidden />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notifiche outbound (simulate)</DropdownMenuLabel>
          {items.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nessuna notifica</p>}
          {items.map((n) => (
            <DropdownMenuItem key={n.notificationId} render={<Link href="/audit?tab=notifications" />} className="flex flex-col items-start gap-0.5">
              <span className="line-clamp-1 text-sm">{n.subject}</span>
              <span className="text-xs text-muted-foreground">
                {n.channel} · {n.agencyName} · {fmtTime(n.timestamp)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Topbar() {
  const [open, setOpen] = useState(false)
  const { session } = useSession()
  const integ = session?.integration

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Apri menu" onClick={() => setOpen(true)}>
        <Menu className="size-5" aria-hidden />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b">
            <SheetTitle render={<div />}>
              <Brand />
            </SheetTitle>
          </SheetHeader>
          <div className="px-3 py-2">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#8a5f0d]">
          Demo Environment
        </span>
        {integ && (
          <span className="hidden truncate text-xs text-muted-foreground xl:inline">
            {integ.classification.simulated ? 'Classificazione simulata' : integ.classification.modelName}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <ConnectionStatus />
        <EnvironmentSwitcher />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
