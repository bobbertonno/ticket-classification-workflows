import { route } from '@/lib/server/http'
import { handleDecision } from '@/lib/server/task-decision'

export const maxDuration = 60

export const POST = route<{ id: string }>('/api/human-tasks/[id]/reject', async (req, { params }) => {
  const { id } = await params
  return handleDecision(req, id, 'REJECTED')
})
