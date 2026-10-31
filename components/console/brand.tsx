/**
 * Configurable branding. Set NEXT_PUBLIC_BRAND_LOGO_URL to an authorized logo asset
 * (e.g. /brand/logo.svg placed in /public). Without it a neutral wordmark is rendered;
 * the official Generali logo is intentionally not reproduced.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  const logoUrl = process.env.NEXT_PUBLIC_BRAND_LOGO_URL
  const name = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Automation Control Center'

  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary authorized asset URL
        <img src={logoUrl} alt={name} className="h-8 w-auto" />
      ) : (
        <div aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold tracking-tight text-primary-foreground">
          AC
        </div>
      )}
      {!compact && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="truncate text-xs text-muted-foreground">Insurance Operations</span>
        </div>
      )}
    </div>
  )
}
