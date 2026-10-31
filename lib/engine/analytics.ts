import type { Category, ExecutionMode, InstanceStatus, WorkflowInstance } from '@/lib/domain/schemas'
import { CATEGORY_LABELS } from '@/lib/domain/seed-data'
import type { DataStore } from '@/lib/store/types'

export interface DashboardFilters {
  from?: string
  to?: string
  agencyId?: string
  workflowId?: string
  status?: InstanceStatus
  mode?: ExecutionMode
}

function durationMin(i: WorkflowInstance): number | null {
  if (!i.completedAt) return null
  return (new Date(i.completedAt).getTime() - new Date(i.createdAt).getTime()) / 60_000
}

function humanTouched(i: WorkflowInstance): boolean {
  return i.steps.some((s) => s.type === 'human_approval' && (s.status === 'COMPLETED' || s.status === 'WAITING' || s.status === 'FAILED'))
}

function isStp(i: WorkflowInstance): boolean {
  return i.status === 'COMPLETED' && !humanTouched(i) && i.steps.every((s) => s.attempts <= 1)
}

function applyFilters(list: WorkflowInstance[], f: DashboardFilters): WorkflowInstance[] {
  const from = f.from ? new Date(f.from).getTime() : null
  const to = f.to ? new Date(f.to).getTime() + 86_399_999 : null
  return list.filter(
    (i) =>
      (!f.agencyId || i.agencyId === f.agencyId) &&
      (!f.workflowId || i.workflowId === f.workflowId) &&
      (!f.status || i.status === f.status) &&
      (!f.mode || i.executionMode === f.mode) &&
      (from === null || new Date(i.createdAt).getTime() >= from) &&
      (to === null || new Date(i.createdAt).getTime() <= to),
  )
}

const pct = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10)

export async function buildDashboard(store: DataStore, filters: DashboardFilters) {
  const all = await store.collection('workflow_instances').find()
  const list = applyFilters(all, filters)
  const completed = list.filter((i) => i.status === 'COMPLETED')
  const failed = list.filter((i) => i.status === 'FAILED')
  const running = list.filter((i) => ['RUNNING', 'PENDING', 'RETRYING'].includes(i.status))
  const waiting = list.filter((i) => i.status === 'WAITING_FOR_HUMAN')
  const durations = completed.map(durationMin).filter((d): d is number => d !== null)
  const withinSla = completed.filter((i) => (durationMin(i) ?? Infinity) <= i.slaMinutes).length
  const tasks = await store.collection('human_tasks').find({ status: 'PENDING' }, { sort: { field: 'dueAt', dir: 1 } })
  const filteredTasks = tasks.filter((t) => !filters.agencyId || t.agencyId === filters.agencyId)

  const days = new Map<string, { date: string; completed: number; failed: number; inProgress: number; total: number }>()
  for (let d = 13; d >= 0; d--) {
    const key = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
    days.set(key, { date: key, completed: 0, failed: 0, inProgress: 0, total: 0 })
  }
  for (const i of list) {
    const key = i.createdAt.slice(0, 10)
    const b = days.get(key)
    if (!b) continue
    b.total++
    if (i.status === 'COMPLETED') b.completed++
    else if (i.status === 'FAILED' || i.status === 'CANCELLED') b.failed++
    else b.inProgress++
  }

  const byCategory = new Map<string, number>()
  for (const i of list) {
    const c = (i.context.category as Category | null) ?? 'UNKNOWN'
    byCategory.set(c, (byCategory.get(c) ?? 0) + 1)
  }
  const byAgency = new Map<string, { agencyId: string; agencyName: string; count: number }>()
  for (const i of list) {
    const a = byAgency.get(i.agencyId) ?? { agencyId: i.agencyId, agencyName: i.agencyName, count: 0 }
    a.count++
    byAgency.set(i.agencyId, a)
  }

  const finished = completed.length + failed.length
  const recent = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
  const errors = [...all.filter((i) => i.status === 'FAILED' || i.status === 'RETRYING')]
    .filter((i) => applyFilters([i], { ...filters, status: undefined }).length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((i) => {
      const s = i.steps.find((x) => x.status === 'FAILED')
      return { instanceId: i.instanceId, ticketId: i.ticketId, agencyId: i.agencyId, workflowName: i.workflowName, status: i.status, step: s?.label ?? '', error: s?.error ?? '', at: i.updatedAt }
    })

  return {
    kpis: {
      total: list.length,
      completed: completed.length,
      running: running.length,
      waiting: waiting.length,
      failed: failed.length,
      pendingTasks: filteredTasks.length,
      successRate: pct(completed.length, finished),
      avgResolutionMin: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
      slaCompliance: pct(withinSla, completed.length),
      stpRate: pct(completed.filter(isStp).length, completed.length),
    },
    timeline: [...days.values()],
    byCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, label: CATEGORY_LABELS[category as Category] ?? category, count }))
      .sort((a, b) => b.count - a.count),
    modeSplit: [
      { mode: 'Automatico (STP)', count: list.filter((i) => !humanTouched(i)).length },
      { mode: 'Human-in-the-Loop', count: list.filter(humanTouched).length },
    ],
    recent: recent.map((i) => ({
      instanceId: i.instanceId,
      ticketId: i.ticketId,
      agencyId: i.agencyId,
      agencyName: i.agencyName,
      workflowName: i.workflowName,
      status: i.status,
      currentStep: i.steps[i.currentStepIndex]?.label ?? '',
      createdAt: i.createdAt,
      seeded: i.seeded,
    })),
    recentErrors: errors,
    pendingApprovals: filteredTasks.slice(0, 5),
    topAgencies: [...byAgency.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    dataSource: {
      seededCount: list.filter((i) => i.seeded).length,
      liveCount: list.filter((i) => !i.seeded).length,
    },
  }
}

export async function buildAgencyAnalytics(store: DataStore) {
  const [agencies, instances, tickets] = await Promise.all([
    store.collection('agencies').find(),
    store.collection('workflow_instances').find(),
    store.collection('remedy_tickets').find(),
  ])
  const rows = agencies.map((a) => {
    const inst = instances.filter((i) => i.agencyId === a.agencyId)
    const tix = tickets.filter((t) => t.agencyId === a.agencyId)
    const completed = inst.filter((i) => i.status === 'COMPLETED')
    const failed = inst.filter((i) => i.status === 'FAILED' || i.status === 'CANCELLED')
    const durations = completed.map(durationMin).filter((d): d is number => d !== null)
    const cats = new Map<string, number>()
    for (const t of tix) if (t.category) cats.set(t.category, (cats.get(t.category) ?? 0) + 1)
    return {
      agencyId: a.agencyId,
      agencyName: a.agencyName,
      region: a.region,
      city: a.city,
      geographicArea: a.geographicArea,
      operatorName: a.operatorName,
      status: a.status,
      totalTickets: tix.length,
      completed: completed.length,
      failed: failed.length,
      open: tix.filter((t) => !['CLOSED', 'ESCALATED', 'FAILED'].includes(t.status)).length,
      automationRate: pct(inst.filter((i) => !humanTouched(i)).length, inst.length),
      humanInterventionRate: pct(inst.filter(humanTouched).length, inst.length),
      avgResolutionMin: durations.length ? Math.round((durations.reduce((x, y) => x + y, 0) / durations.length) * 10) / 10 : null,
      slaCompliance: pct(completed.filter((i) => (durationMin(i) ?? Infinity) <= i.slaMinutes).length, completed.length),
      topCategories: [...cats.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([category, count]) => ({ category, label: CATEGORY_LABELS[category as Category], count })),
      categories: Object.fromEntries(cats),
    }
  })
  const regions = new Map<string, { area: string; tickets: number; completed: number; failed: number }>()
  for (const r of rows) {
    const g = regions.get(r.geographicArea) ?? { area: r.geographicArea, tickets: 0, completed: 0, failed: 0 }
    g.tickets += r.totalTickets
    g.completed += r.completed
    g.failed += r.failed
    regions.set(r.geographicArea, g)
  }
  return { agencies: rows.sort((a, b) => b.totalTickets - a.totalTickets), regions: [...regions.values()] }
}
