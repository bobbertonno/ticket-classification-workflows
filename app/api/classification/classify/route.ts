import { z } from 'zod'
import { compareMethods } from '@/lib/classification/classifier'
import { getSettings } from '@/lib/engine/support'
import { getContext } from '@/lib/server/context'
import { ok, parseBody, route } from '@/lib/server/http'

export const maxDuration = 30

/** Ad-hoc classification playground: compares keyword, semantic and hybrid methods without creating a ticket. */
export const POST = route('/api/classification/classify', async (req) => {
  const { store, deps, integration } = await getContext({ requireInitialized: true })
  const { text } = await parseBody(req, z.object({ text: z.string().trim().min(5).max(2000) }))
  const settings = await getSettings(store)
  const comparison = await compareMethods(store, deps.retriever, text, settings)
  return ok({ comparison, integration: integration.classification })
})
