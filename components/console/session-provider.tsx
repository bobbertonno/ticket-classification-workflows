'use client'

import { createContext, useContext, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { apiSend, fetcher, refreshAll } from '@/lib/client/api'
import type { SessionData } from '@/lib/client/types'

interface SessionValue {
  session: SessionData | undefined
  isLoading: boolean
  error: Error | undefined
  reload: () => Promise<unknown>
  can: (role: 'admin' | 'approver') => boolean
}

const SessionContext = createContext<SessionValue | null>(null)

const HEARTBEAT_MS = { instant: 4000, fast: 900, normal: 1500, slow: 3000 } as const

/**
 * Loads the session and drives the server-side execution tick. Workflow state lives on the
 * server; the open console simply calls /api/engine/tick so persisted instances advance.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data, error, isLoading, mutate } = useSWR<SessionData>('/api/session', fetcher, { refreshInterval: 10_000 })
  const ticking = useRef(false)

  const ready = Boolean(data?.integration && data.settings && !data.contextError)
  const speed = data?.settings?.simulationSpeed ?? 'normal'
  const paused = data?.settings?.paused ?? false

  useEffect(() => {
    if (!ready || paused) return
    const id = window.setInterval(async () => {
      if (ticking.current || document.visibilityState !== 'visible') return
      ticking.current = true
      try {
        const res = await apiSend<{ processed: number }>('/api/engine/tick', {})
        if (res.processed > 0) await refreshAll()
      } catch {
        // Tick failures are surfaced through the integration status in the top bar.
      } finally {
        ticking.current = false
      }
    }, HEARTBEAT_MS[speed])
    return () => window.clearInterval(id)
  }, [ready, paused, speed])

  const role = data?.actor.role
  const can = (r: 'admin' | 'approver') => role === 'admin' || (r === 'approver' && role === 'approver')

  return <SessionContext.Provider value={{ session: data, isLoading, error, reload: mutate, can }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
