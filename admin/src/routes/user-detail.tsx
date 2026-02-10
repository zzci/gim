import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api'
import { ConfirmDialog } from '../components/confirm-dialog'

interface UserDetail {
  user: {
    id: string
    createdAt: string
    isGuest: boolean
    isDeactivated: boolean
    admin: boolean
  }
  profile: {
    displayname: string | null
    avatar_url: string | null
  }
  devices: Array<{
    deviceId: string
    displayName: string | null
    lastSeenIp: string | null
    lastSeenTs: number | null
  }>
  rooms: Array<{
    roomId: string
    membership: string
  }>
}

export function UserDetailPage() {
  const { userId } = useParams({ from: '/users/$userId' })
  const queryClient = useQueryClient()
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api<UserDetail>(`/users/${encodeURIComponent(userId)}`),
  })

  const toggleAdmin = useMutation({
    mutationFn: () => api(`/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ admin: !data?.user.admin }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user', userId] }),
  })

  const toggleDeactivated = useMutation({
    mutationFn: () => api(`/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ isDeactivated: !data?.user.isDeactivated }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user', userId] }),
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

  const { user, profile, devices, rooms } = data

  return (
    <div>
      <div className="mb-6">
        <Link to="/users" className="text-sm text-gray-400 hover:text-gray-200">&larr; Back to users</Link>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-white">{userId}</h2>
          {profile.displayname && (
            <p className="text-gray-400 mt-1">{profile.displayname}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => toggleAdmin.mutate()}
            disabled={toggleAdmin.isPending}
            className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {user.admin ? 'Remove admin' : 'Make admin'}
          </button>
          <button
            onClick={() => setShowDeactivateDialog(true)}
            disabled={toggleDeactivated.isPending}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50 ${
              user.isDeactivated
                ? 'bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30'
                : 'bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30'
            }`}
          >
            {user.isDeactivated ? 'Reactivate' : 'Deactivate'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDeactivateDialog}
        onConfirm={() => {
          setShowDeactivateDialog(false)
          toggleDeactivated.mutate()
        }}
        onCancel={() => setShowDeactivateDialog(false)}
        title={user.isDeactivated ? 'Reactivate user' : 'Deactivate user'}
        description={user.isDeactivated
          ? `Are you sure you want to reactivate ${userId}?`
          : `Are you sure you want to deactivate ${userId}? They will lose access to their account.`}
        confirmLabel={user.isDeactivated ? 'Reactivate' : 'Deactivate'}
        variant={user.isDeactivated ? 'warning' : 'danger'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Info</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd>{user.isDeactivated ? 'Deactivated' : 'Active'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Admin</dt>
              <dd>{user.admin ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Guest</dt>
              <dd>{user.isGuest ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Created</dt>
              <dd>{new Date(user.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-3">
            Devices (
            {devices.length}
            )
          </h3>
          {devices.length === 0
            ? (
                <p className="text-sm text-gray-500">No devices</p>
              )
            : (
                <div className="space-y-2">
                  {devices.map(d => (
                    <div key={d.deviceId} className="text-sm p-2 bg-gray-800/50 rounded">
                      <p className="text-gray-200 font-mono text-xs">{d.deviceId}</p>
                      {d.displayName && <p className="text-gray-400 text-xs mt-0.5">{d.displayName}</p>}
                    </div>
                  ))}
                </div>
              )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-400 mb-3">
            Rooms (
            {rooms.length}
            )
          </h3>
          {rooms.length === 0
            ? (
                <p className="text-sm text-gray-500">Not in any rooms</p>
              )
            : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {rooms.map(r => (
                    <Link
                      key={r.roomId}
                      to="/rooms/$roomId"
                      params={{ roomId: r.roomId }}
                      className="text-sm p-2 bg-gray-800/50 rounded hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-blue-400 font-mono text-xs">{r.roomId}</span>
                      <span className="text-gray-500 text-xs ml-2">{r.membership}</span>
                    </Link>
                  ))}
                </div>
              )}
        </div>
      </div>
    </div>
  )
}
