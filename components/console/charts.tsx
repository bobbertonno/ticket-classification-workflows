'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtDay } from '@/lib/client/format'

export const CHART_COLORS = ['#C8102E', '#2563EB', '#16803C', '#D99A20', '#667085', '#A30D26', '#0E7490', '#7C3AED']

const axis = { fontSize: 11, fill: '#667085' }
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }

export function ExecutionsOverTime({ data }: { data: { date: string; completed: number; failed: number; inProgress: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="g-completed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16803C" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#16803C" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E5E7EB" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tick={axis} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtDay(String(l))} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Area type="monotone" dataKey="completed" name="Completati" stroke="#16803C" fill="url(#g-completed)" strokeWidth={2} stackId="1" />
        <Area type="monotone" dataKey="inProgress" name="In corso" stroke="#2563EB" fill="#2563EB" fillOpacity={0.08} strokeWidth={2} stackId="1" />
        <Area type="monotone" dataKey="failed" name="Falliti / annullati" stroke="#D92D20" fill="#D92D20" fillOpacity={0.1} strokeWidth={2} stackId="1" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function HorizontalBars({ data, dataKey, labelKey, height = 240, color = '#C8102E', name }: { data: Record<string, unknown>[]; dataKey: string; labelKey: string; height?: number; color?: string; name: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#E5E7EB" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={labelKey} width={150} tick={axis} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F7F8FA' }} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Donut({ data, nameKey, dataKey, height = 220 }: { data: Record<string, unknown>[]; nameKey: string; dataKey: string; height?: number }) {
  const total = data.reduce((s, d) => s + Number(d[dataKey] ?? 0), 0)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Pie data={total ? data : [{ [nameKey]: 'Nessun dato', [dataKey]: 1 }]} nameKey={nameKey} dataKey={dataKey} innerRadius={50} outerRadius={78} paddingAngle={2} stroke="none">
          {(total ? data : [0]).map((_, i) => (
            <Cell key={i} fill={total ? CHART_COLORS[i % CHART_COLORS.length] : '#E5E7EB'} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
}

export function GroupedBars({ data, labelKey, series, height = 260 }: { data: Record<string, unknown>[]; labelKey: string; series: { key: string; name: string; color: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#E5E7EB" vertical={false} />
        <XAxis dataKey={labelKey} tick={axis} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F7F8FA' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} barSize={18} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
