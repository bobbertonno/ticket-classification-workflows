import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import { EngineError } from '@/lib/engine/engine'
import type { Actor } from '@/lib/engine/support'
import { ContextError } from './context'
import { log } from './log'

export interface ApiSuccess<T> {
  ok: true
  data: T
}
export interface ApiFailure {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json<ApiFailure>({ ok: false, error: { code, message, details } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export function requireRole(actor: Actor, roles: Actor['role'][]): void {
  if (!roles.includes(actor.role)) throw new HttpError(403, 'FORBIDDEN', `Operazione non consentita al ruolo "${actor.role}"`)
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Corpo della richiesta non è JSON valido')
  }
  return schema.parse(raw)
}

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>

export function route<P = Record<string, string>>(name: string, fn: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    const started = Date.now()
    try {
      const res = await fn(req, ctx)
      log('INFO', `${req.method} ${name}`, { 'http.status_code': res.status, 'duration.ms': Date.now() - started })
      return res
    } catch (err) {
      if (err instanceof ZodError) {
        return fail(422, 'VALIDATION_ERROR', err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), err.issues)
      }
      if (err instanceof HttpError || err instanceof ContextError || err instanceof EngineError) {
        log('WARN', `${req.method} ${name} rejected`, { code: err.code, 'http.status_code': err.status, message: err.message })
        return fail(err.status, err.code, err.message)
      }
      log('ERROR', `${req.method} ${name} failed`, { error: (err as Error).message, stack: (err as Error).stack?.split('\n').slice(0, 4).join(' | ') })
      return fail(500, 'INTERNAL_ERROR', 'Errore interno del server. Consultare i log strutturati.')
    }
  }
}
