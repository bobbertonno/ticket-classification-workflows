'use client'

import { mutate } from 'swr'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

async function unwrap<T>(res: Response): Promise<T> {
  let body: Envelope<T> | null = null
  try {
    body = (await res.json()) as Envelope<T>
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `Risposta non valida dal server (HTTP ${res.status})`)
  }
  if (!body.ok) throw new ApiError(res.status, body.error.code, body.error.message)
  return body.data
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  return unwrap<T>(res)
}

export async function apiSend<T>(url: string, body?: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return unwrap<T>(res)
}

/** Revalidates every mounted SWR key that targets the application API. */
export function refreshAll() {
  return mutate((key) => typeof key === 'string' && key.startsWith('/api/'))
}

export function qs(params: Record<string, string | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v && v !== 'all') as [string, string][]
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
}
