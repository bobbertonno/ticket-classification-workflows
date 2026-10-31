'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import {
  Activity,
  BarChart3,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  Network,
  Radio,
  ScrollText,
  Settings,
  Sparkles,
  Ticket,
  Workflow,
} from 'lucide-react'
import { fetcher } from '@/lib/client/api'
import { cn } from '@/lib/utils'
import { Brand } from './brand'
import { useSession } from './session-provider'

export const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/kafka', label: 'Kafka Simulator', icon: Radio },
  { href: '/workflows', label: 'Workflow Catalog', icon: Workflow },
  { href: '/executions', label: 'Live Executions', icon: Activity },
  { href: '/tasks', label: 'Human Tasks', icon: ClipboardCheck, badge: 'tasks' as const },
  { href: '/tickets', label: 'Remedy Tickets', icon: Ticket },
  { href: '/classification', label: 'Classificazione semantica', icon: Sparkles },
  { href: '/agencies', label: 'Performance agenzie', icon: Building2 },
  { href: '/audit', label: 'Audit & Analytics', icon: BarChart3 },
  { href: '/architecture', label: 'Architettura', icon: Network },
  { href: '/settings', label: 'Impostazioni e integrazioni', icon: Settings },
]

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { session } = useSession()
  const ready = Boolean(session?.integration && !session.contextError && session.environments.length)
  const { data } = useSWR<{ tasks: { status: string }[] }>(ready ? '/api/human-tasks?status=PENDING' : null, fetcher, { refreshInterval: 4000 })
  const pending = data?.tasks.length ?? 0

  return (
    <nav aria-label="Navigazione principale" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-primary" />}
            <Icon className={cn('size-4 shrink-0', active && 'text-primary')} aria-hidden />
            <span className="truncate">{item.label}</span>
            {item.badge === 'tasks' && pending > 0 && (
              <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                {pending}
                <span className="sr-only"> attività in attesa</span>
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav />
      </div>
      <div className="border-t px-5 py-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Ambiente dimostrativo</p>
        <p>Dati sintetici. Prodotto non ufficiale né approvato da Assicurazioni Generali.</p>
      </div>
    </aside>
  )
}
