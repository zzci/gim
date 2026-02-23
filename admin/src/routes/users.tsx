import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api'

interface User {
  id: string
  createdAt: string
  isGuest: boolean
  isDeactivated: boolean
  admin: boolean
  displayname: string | null
}

interface UsersResponse {
  users: User[]
  total: number
}

const LIMIT = 50

export function UsersPage() {
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['users', search, offset],
    queryFn: () => api<UsersResponse>(`/users?limit=${LIMIT}&offset=${offset}&search=${encodeURIComponent(search)}`),
  })

  const total = data?.total ?? 0
  const hasNext = offset + LIMIT < total
  const hasPrev = offset > 0

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Users</h2>
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search users..."
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
              <th className="text-left px-4 py-3 font-medium">User ID</th>
              <th className="text-left px-4 py-3 font-medium">Display Name</th>
              <th className="text-left px-4 py-3 font-medium">Admin</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                )
              : !data?.users.length
                  ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
                    )
                  : data.users.map(user => (
                      <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            to="/users/$userId"
                            params={{ userId: user.id }}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            {user.id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{user.displayname || '-'}</td>
                        <td className="px-4 py-3">
                          {user.admin
                            ? (
                                <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded text-xs">admin</span>
                              )
                            : null}
                        </td>
                        <td className="px-4 py-3">
                          {user.isDeactivated
                            ? (
                                <span className="px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded text-xs">deactivated</span>
                              )
                            : user.isGuest
                              ? (
                                  <span className="px-2 py-0.5 bg-gray-500/10 text-gray-400 border border-gray-500/20 rounded text-xs">guest</span>
                                )
                              : (
                                  <span className="px-2 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded text-xs">active</span>
                                )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</td>
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
