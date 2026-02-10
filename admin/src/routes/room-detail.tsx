import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { api } from '../api'

interface RoomDetail {
  room: {
    id: string
    version: string
    creatorId: string
    isDirect: boolean
    createdAt: string
  }
  members: Array<{
    userId: string
    membership: string
    displayname: string | null
  }>
}

export function RoomDetailPage() {
  const { roomId } = useParams({ from: '/rooms/$roomId' })

  const { data, isLoading, error } = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => api<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}`),
  })

  if (isLoading)
    return <div className="text-gray-400">Loading...</div>
  if (error) {
    return (
      <div className="text-red-400">
        Error:
        {(error as Error).message}
      </div>
    )
  }
  if (!data)
    return null

  const { room, members } = data

  return (
    <div>
      <div className="mb-6">
        <Link to="/rooms" className="text-sm text-gray-400 hover:text-gray-200">&larr; Back to rooms</Link>
      </div>
      <h2 className="text-xl font-semibold text-white mb-6 font-mono text-base">{roomId}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Info</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Version</dt>
              <dd>{room.version}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Creator</dt>
              <dd className="font-mono text-xs">{room.creatorId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Type</dt>
              <dd>{room.isDirect ? 'Direct message' : 'Room'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Created</dt>
              <dd>{new Date(room.createdAt).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Members</dt>
              <dd>{members.length}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-3">
            Members (
            {members.length}
            )
          </h3>
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.userId} className="flex items-center justify-between text-sm p-2 bg-gray-800/50 rounded">
                <div>
                  <Link
                    to="/users/$userId"
                    params={{ userId: m.userId }}
                    className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                  >
                    {m.userId}
                  </Link>
                  {m.displayname && <span className="text-gray-500 text-xs ml-2">{m.displayname}</span>}
                </div>
                <span className={`px-2 py-0.5 rounded text-xs border ${
                  m.membership === 'join'
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : m.membership === 'invite'
                      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                      : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                }`}
                >
                  {m.membership}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
