import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
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

interface StateEvent {
  type: string
  state_key: string
  sender: string
  content: Record<string, unknown>
  event_id: string
  origin_server_ts: number
}

export function RoomDetailPage() {
  const { roomId } = useParams({ from: '/rooms/$roomId' })
  const queryClient = useQueryClient()
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [showEditForm, setShowEditForm] = useState(false)
  const [editType, setEditType] = useState('')
  const [editStateKey, setEditStateKey] = useState('')
  const [editContent, setEditContent] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => api<RoomDetail>(`/rooms/${encodeURIComponent(roomId)}`),
  })

  const { data: stateEvents } = useQuery({
    queryKey: ['room-state', roomId],
    queryFn: () => api<StateEvent[]>(`/rooms/${encodeURIComponent(roomId)}/state`),
  })

  const setStateMutation = useMutation({
    mutationFn: (params: { eventType: string, stateKey: string, content: Record<string, unknown> }) =>
      api(`/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(params.eventType)}/${encodeURIComponent(params.stateKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ content: params.content }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-state', roomId] })
      setShowEditForm(false)
      setEditType('')
      setEditStateKey('')
      setEditContent('')
    },
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

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const content = JSON.parse(editContent)
      setStateMutation.mutate({ eventType: editType, stateKey: editStateKey, content })
    }
    catch {
      // invalid JSON - do nothing
    }
  }

  function openEditFor(event: StateEvent) {
    setEditType(event.type)
    setEditStateKey(event.state_key)
    setEditContent(JSON.stringify(event.content, null, 2))
    setShowEditForm(true)
  }

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

      {/* Room State Section */}
      <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">
            Room State
            {stateEvents ? ` (${stateEvents.length})` : ''}
          </h3>
          <button
            onClick={() => {
              setShowEditForm(!showEditForm)
              setEditType('')
              setEditStateKey('')
              setEditContent('{}')
            }}
            className="px-3 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {showEditForm ? 'Cancel' : 'Edit State'}
          </button>
        </div>

        {showEditForm && (
          <form onSubmit={handleEditSubmit} className="mb-4 p-3 bg-gray-800/50 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Event Type</label>
                <input
                  type="text"
                  value={editType}
                  onChange={e => setEditType(e.target.value)}
                  placeholder="m.room.name"
                  className="w-full px-2 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">State Key</label>
                <input
                  type="text"
                  value={editStateKey}
                  onChange={e => setEditStateKey(e.target.value)}
                  placeholder=""
                  className="w-full px-2 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 placeholder-gray-600"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Content (JSON)</label>
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={4}
                className="w-full px-2 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded text-gray-200 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={!editType || setStateMutation.isPending}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {setStateMutation.isPending ? 'Saving...' : 'Save State'}
            </button>
            {setStateMutation.error && (
              <p className="text-xs text-red-400">
                {(setStateMutation.error as Error).message}
              </p>
            )}
          </form>
        )}

        {stateEvents && stateEvents.length > 0
          ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                      <th className="pb-2 pr-4">Type</th>
                      <th className="pb-2 pr-4">State Key</th>
                      <th className="pb-2 pr-4">Sender</th>
                      <th className="pb-2 pr-4">Content</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {stateEvents.map(e => (
                      <tr key={e.event_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 pr-4 font-mono text-xs text-gray-300">{e.type}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-400">{e.state_key || '(empty)'}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-400">{e.sender}</td>
                        <td className="py-2 pr-4">
                          <button
                            onClick={() => setExpandedEvent(expandedEvent === e.event_id ? null : e.event_id)}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            {expandedEvent === e.event_id ? 'Hide' : 'Show'}
                          </button>
                          {expandedEvent === e.event_id && (
                            <pre className="mt-1 p-2 bg-gray-800 rounded text-xs text-gray-300 overflow-x-auto max-w-md">
                              {JSON.stringify(e.content, null, 2)}
                            </pre>
                          )}
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => openEditFor(e)}
                            className="text-xs text-gray-500 hover:text-gray-300"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          : (
              <p className="text-sm text-gray-500">No state events</p>
            )}
      </div>
    </div>
  )
}
