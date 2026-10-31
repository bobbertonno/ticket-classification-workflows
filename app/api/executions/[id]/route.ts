import { createDownloadUrl } from '@/lib/server/artifact-links'
import { getContext } from '@/lib/server/context'
import { HttpError, ok, route } from '@/lib/server/http'
import { executionDetail } from '@/lib/server/queries'

export const GET = route<{ id: string }>('/api/executions/[id]', async (_req, { params }) => {
  const { id } = await params
  const { store, env, actor } = await getContext()
  const detail = await executionDetail(store, id)
  if (!detail) throw new HttpError(404, 'NOT_FOUND', `Esecuzione ${id} non trovata`)
  return ok({
    ...detail,
    artifacts: detail.artifacts.map((a) => ({ ...a, download: createDownloadUrl(a.artifactId, env.environmentId, actor.id) })),
  })
})
