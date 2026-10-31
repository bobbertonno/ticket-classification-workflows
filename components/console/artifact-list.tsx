'use client'

import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, Pill } from '@/components/console/kit'
import { fmtDateTime } from '@/lib/client/format'
import type { Artifact } from '@/lib/domain/schemas'

export type ArtifactWithLink = Artifact & { download?: { url: string; expiresAt: string } }

export function ArtifactList({ artifacts }: { artifacts: ArtifactWithLink[] }) {
  if (!artifacts.length) return <EmptyState title="Nessun documento generato" />
  return (
    <ul className="flex flex-col gap-2">
      {artifacts.map((a) => {
        const xlsx = a.mimeType.includes('spreadsheet')
        const Icon = xlsx ? FileSpreadsheet : FileText
        return (
          <li key={a.artifactId} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${xlsx ? 'bg-success/10 text-success' : 'bg-accent text-primary'}`}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{a.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {a.rowCount} righe · rev. {a.revision} · {fmtDateTime(a.createdAt)} · sha {a.contentHash.slice(0, 10)}
                </span>
              </div>
              <Pill tone="warning" className="hidden sm:inline-flex">
                DEMO
              </Pill>
            </div>
            {a.download ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={a.download.url} download={a.fileName} title={`Link firmato, scade ${fmtDateTime(a.download.expiresAt)}`} />}
              >
                <Download className="size-3.5" aria-hidden />
                Scarica
              </Button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
