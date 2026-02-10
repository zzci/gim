import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

interface Stats {
  users: number
  rooms: number
  events: number
  media: number
}

interface TrendPoint {
  date: string
  count: number
}

interface StatsHistory {
  users: TrendPoint[]
  rooms: TrendPoint[]
  media: TrendPoint[]
  messages: TrendPoint[]
}

const statCards = [
  { key: 'users' as const, label: 'Users', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  { key: 'rooms' as const, label: 'Rooms', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  { key: 'events' as const, label: 'Events', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  { key: 'media' as const, label: 'Media', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
]

const trendCharts: Array<{ key: keyof StatsHistory, label: string, stroke: string, fill: string }> = [
  { key: 'users', label: 'Users', stroke: '#3b82f6', fill: '#3b82f620' },
  { key: 'rooms', label: 'Rooms', stroke: '#22c55e', fill: '#22c55e20' },
  { key: 'media', label: 'Media', stroke: '#f97316', fill: '#f9731620' },
  { key: 'messages', label: 'Messages', stroke: '#a855f7', fill: '#a855f720' },
]

function MiniChart({ data, stroke, fill }: { data: TrendPoint[], stroke: string, fill: string }) {
  if (data.length === 0) {
    return (
      <svg viewBox="0 0 200 80" className="w-full h-20">
        <text x="100" y="44" textAnchor="middle" fill="#6b7280" fontSize="11">No data</text>
      </svg>
    )
  }

  const w = 200
  const h = 80
  const padX = 4
  const padTop = 4
  const padBottom = 16
  const chartW = w - padX * 2
  const chartH = h - padTop - padBottom

  const maxCount = Math.max(...data.map(d => d.count), 1)
  const points = data.map((d, i) => ({
    x: padX + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW),
    y: padTop + chartH - (d.count / maxCount) * chartH,
  }))

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
  const areaPath = `M${points[0]!.x},${padTop + chartH} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1]!.x},${padTop + chartH} Z`

  const firstDate = data[0]?.date.slice(5) ?? ''
  const lastDate = data[data.length - 1]?.date.slice(5) ?? ''

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
      <path d={areaPath} fill={fill} />
      <polyline points={polyline} fill="none" stroke={stroke} strokeWidth="1.5" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={stroke} />
      ))}
      <text x={padX} y={h - 2} fill="#6b7280" fontSize="9">{firstDate}</text>
      <text x={w - padX} y={h - 2} fill="#6b7280" fontSize="9" textAnchor="end">{lastDate}</text>
    </svg>
  )
}

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/stats'),
  })

  const { data: history } = useQuery({
    queryKey: ['stats-history'],
    queryFn: () => api<StatsHistory>('/stats/history'),
  })

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Dashboard</h2>
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-sm">
          Failed to load stats:
          {' '}
          {(error as Error).message}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.key} className={`rounded-lg border p-5 ${card.color}`}>
            <p className="text-sm font-medium opacity-80">{card.label}</p>
            <p className="text-3xl font-bold mt-1">
              {isLoading
                ? (
                    <span className="inline-block w-16 h-8 bg-gray-700/50 rounded animate-pulse" />
                  )
                : (
                    data?.[card.key]?.toLocaleString() ?? '-'
                  )}
            </p>
          </div>
        ))}
      </div>

      {history && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-gray-400 mb-4">30-day trends</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {trendCharts.map(chart => (
              <div key={chart.key} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <p className="text-xs font-medium text-gray-400 mb-2">{chart.label}</p>
                <MiniChart
                  data={history[chart.key] ?? []}
                  stroke={chart.stroke}
                  fill={chart.fill}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
