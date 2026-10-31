import { renderArtifact } from '@/lib/documents/render'
import { audit } from '@/lib/engine/support'
import { verifyDownloadToken } from '@/lib/server/artifact-links'
import { getContext } from '@/lib/server/context'
import { HttpError, route } from '@/lib/server/http'

export const maxDuration = 30

/**
 * Demo-only storage: artifacts are regenerated deterministically from persisted metadata
 * (params + content hash), so no file lives on the serverless filesystem.
 */
export const GET = route<{ id: string }>('/api/artifacts/[id]/download', async (req, { params }) => {
  const { id } = await params
  const { store, env, actor } = await getContext()
  const err = verifyDownloadToken(new URL(req.url).searchParams.get('token'), id, env.environmentId, actor.id)
  if (err) throw new HttpError(403, 'DOWNLOAD_FORBIDDEN', err)
  const artifact = await store.collection('artifacts').findOne({ artifactId: id })
  if (!artifact) throw new HttpError(404, 'NOT_FOUND', 'Artefatto non trovato')
  const bytes = await renderArtifact(artifact)
  await audit(store, {
    actor: actor.name,
    actorType: 'USER',
    agencyId: artifact.agencyId,
    instanceId: artifact.instanceId,
    ticketId: artifact.ticketId,
    action: 'ARTIFACT_DOWNLOADED',
    previousState: null,
    newState: null,
    correlationId: null,
    outcome: 'SUCCESS',
    eventType: 'ARTIFACT',
    details: JSON.stringify({ artifactId: id, fileName: artifact.fileName }),
  })
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': artifact.mimeType,
      'Content-Disposition': `attachment; filename="${artifact.fileName.replace(/[^\w.\-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  })
})
