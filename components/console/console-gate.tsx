'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingBlock } from './kit'
import { useSession } from './session-provider'

/** Blocks data pages until the selected environment is reachable and initialized; settings stay reachable. */
export function ConsoleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { session, error, isLoading } = useSession()
  if (pathname.startsWith('/settings')) return <>{children}</>
  if (isLoading && !session) return <LoadingBlock rows={6} />
  if (error) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <AlertTriangle className="size-4" aria-hidden /> Sessione non disponibile
        </p>
        <p className="text-sm">{error.message}</p>
      </div>
    )
  }
  const ce = session?.contextError
  if (ce) {
    const notInit = ce.code === 'NOT_INITIALIZED'
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary">
          <Database className="size-5" aria-hidden />
        </span>
        <h1 className="text-lg font-semibold">{notInit ? 'Ambiente da inizializzare' : 'Ambiente non raggiungibile'}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{ce.message}</p>
        <div className="flex gap-2">
          <Button render={<Link href="/settings/setup" />}>{notInit ? 'Apri Setup Wizard' : 'Configura ambiente'}</Button>
          <Button variant="outline" render={<Link href="/settings" />}>
            Impostazioni
          </Button>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
