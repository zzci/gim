import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api'

interface Room {
  id: string
  version: string
  creatorId: string
  isDirect: boolean
  createdAt: string
  memberCount: number
}

interface RoomsResponse {
  rooms: Room[]
  total: number
}

const LIMIT = 50

export function RoomsPage() {
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['rooms', search, offset],
    queryFn: () => api<RoomsResponse>(`/rooms?limit=${LIMIT}&offset=${offset}&search=${encodeURIComponent(search)}`),
  })

  const total = data?.total ?? 0
  const hasNext = offset + LIMIT < total
  const hasPrev = offset > 0

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Rooms</h2>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search rooms..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
          className="w-full max-w-sm px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Room ID</th>
              <th className="text-left px-4 py-3 font-medium">Creator</th>
              <th className="text-left px-4 py-3 font-medium">Members</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                )
              : !data?.rooms.length
                  ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No rooms found</td></tr>
                    )
                  : data.rooms.map(room => (
                      <tr key={room.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            to="/rooms/$roomId"
                            params={{ roomId: room.id }}
                            className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                          >
                            {room.id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-xs font-mono">{room.creatorId}</td>
                        <td className="px-4 py-3 text-gray-300">{room.memberCount}</td>
                        <td className="px-4 py-3">
                          {room.isDirect
                            ? (
                                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-xs">DM</span>
                              )
                            : (
                                <span className="px-2 py-0.5 bg-gray-500/10 text-gray-400 border border-gray-500/20 rounded text-xs">room</span>
                              )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{new Date(room.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
          </tbody>
        </table>
      </div>
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-gray-400">
            Showing
            {' '}
            {offset + 1}
            -
            {Math.min(offset + LIMIT, total)}
            {' '}
            of
            {' '}
            {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
              disabled={!hasPrev}
              className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(o => o + LIMIT)}
              disabled={!hasNext}
              className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
