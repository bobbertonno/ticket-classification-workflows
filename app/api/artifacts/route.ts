import { createDownloadUrl } from '@/lib/server/artifact-links'
import { getContext } from '@/lib/server/context'
import { ok, route } from '@/lib/server/http'

export const GET = route('/api/artifacts', async (req) => {
  const { store, env, actor } = await getContext()
  const url = new URL(req.url)
  const ticketId = url.searchParams.get('ticketId') ?? undefined
  const instanceId = url.searchParams.get('instanceId') ?? undefined
  const artifacts = await store.collection('artifacts').find({ ...(ticketId ? { ticketId } : {}), ...(instanceId ? { instanceId } : {}) })
  return ok({
    artifacts: artifacts
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((a) => ({ ...a, download: createDownloadUrl(a.artifactId, env.environmentId, actor.id) })),
  })
})
