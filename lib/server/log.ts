import 'server-only'

type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
const SEVERITY_NUMBER: Record<Severity, number> = { DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17 }

const SECRET_PATTERNS: [RegExp, string][] = [
  [/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***:***@'],
  [/(api[_-]?key|authorization|password|secret|token)(["'\s:=]+)[^"'\s,}]+/gi, '$1$2[REDACTED]'],
  [/pa-[A-Za-z0-9_-]{20,}/g, '[REDACTED_VOYAGE_KEY]'],
]

export function redact(value: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), value)
}

/** OpenTelemetry log data model compatible structured log line (stdout → Vercel log drains / OTel collector). */
export function log(severity: Severity, body: string, attributes: Record<string, unknown> = {}, traceId?: string | null): void {
  const record = {
    timestamp: new Date().toISOString(),
    severity_text: severity,
    severity_number: SEVERITY_NUMBER[severity],
    body: redact(body),
    resource: { 'service.name': 'generali-automation-control-center', 'deployment.environment': process.env.VERCEL_ENV ?? 'local' },
    attributes: JSON.parse(redact(JSON.stringify(attributes))) as Record<string, unknown>,
    ...(traceId ? { trace_id: traceId } : {}),
  }
  const line = JSON.stringify(record)
  if (severity === 'ERROR') console.error(line)
  else if (severity === 'WARN') console.warn(line)
  else console.log(line)
}
