import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

interface Stats {
  users: number
  rooms: number
  events: number
  media: number
}

const statCards = [
  { key: 'users' as const, label: 'Users', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  { key: 'rooms' as const, label: 'Rooms', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  { key: 'events' as const, label: 'Events', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  { key: 'media' as const, label: 'Media', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
]

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/stats'),
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
    </div>
  )
}
