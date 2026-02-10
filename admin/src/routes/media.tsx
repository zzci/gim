import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api'

interface MediaItem {
  id: string
  userId: string
  contentType: string
  size: number
  filename: string | null
  createdAt: string
}

interface MediaResponse {
  media: MediaItem[]
  total: number
}

const LIMIT = 50

function formatBytes(bytes: number): string {
  if (bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`
}

export function MediaPage() {
  const [offset, setOffset] = useState(0)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['media', offset],
    queryFn: () => api<MediaResponse>(`/media?limit=${LIMIT}&offset=${offset}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (mediaId: string) => api(`/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media'] }),
  })

  const total = data?.total ?? 0
  const hasNext = offset + LIMIT < total
  const hasPrev = offset > 0

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Media</h2>
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-4 py-3 font-medium">ID</th>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Size</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                )
              : !data?.media.length
                  ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No media found</td></tr>
                    )
                  : data.media.map(item => (
                      <tr key={item.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-300">{item.id}</td>
                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">{item.userId}</td>
                        <td className="px-4 py-3 text-gray-400">{item.contentType}</td>
                        <td className="px-4 py-3 text-gray-400">{formatBytes(item.size)}</td>
                        <td className="px-4 py-3 text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              // eslint-disable-next-line no-alert
                              if (confirm('Delete this media item?')) {
                                deleteMutation.mutate(item.id)
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-1 text-xs bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 rounded transition-colors disabled:opacity-50"
                          >
                            Delete
                          </button>
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
