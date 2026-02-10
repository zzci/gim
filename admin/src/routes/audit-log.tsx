import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'

interface AuditEntry {
  id: string
  adminUserId: string
  action: string
  targetType: string
  targetId: string
  details: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

interface AuditResponse {
  entries: AuditEntry[]
  total: number
}

const LIMIT = 50

export function AuditLogPage() {
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', offset],
    queryFn: () => api<AuditResponse>(`/audit-log?limit=${LIMIT}&offset=${offset}`),
  })

  const total = data?.total ?? 0
  const hasNext = offset + LIMIT < total
  const hasPrev = offset > 0

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Audit Log</h2>
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Time</th>
              <th className="text-left px-4 py-3 font-medium">Admin</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Target</th>
              <th className="text-left px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                )
              : !data?.entries.length
                  ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No audit log entries</td></tr>
                    )
                  : data.entries.map(entry => (
                      <tr key={entry.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">{entry.adminUserId}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-xs border bg-gray-800 text-gray-300 border-gray-700">
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-500 text-xs">
                            {entry.targetType}
                            :
                          </span>
                          {' '}
                          <span className="text-gray-300 font-mono text-xs">{entry.targetId}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs font-mono max-w-xs truncate">
                          {entry.details ? JSON.stringify(entry.details) : '-'}
                        </td>
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
