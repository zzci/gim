import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

interface OAuthToken {
  id: string
  userId: string
  clientId: string
  scope: string
  expiresAt: string
  createdAt: string
}

interface UserToken {
  id: string
  userId: string
  name: string
  createdAt: string
}

interface TokensResponse {
  oauth_tokens: OAuthToken[]
  user_tokens: UserToken[]
}

export function TokensPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api<TokensResponse>('/tokens'),
  })

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => api(`/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tokens'] }),
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

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6">Tokens</h2>

      <div className="space-y-8">
        <section>
          <h3 className="text-lg font-medium text-gray-200 mb-4">
            OAuth Tokens (
            {data?.oauth_tokens.length ?? 0}
            )
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Client</th>
                  <th className="text-left px-4 py-3 font-medium">Scope</th>
                  <th className="text-left px-4 py-3 font-medium">Expires</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!data?.oauth_tokens.length
                  ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No OAuth tokens</td></tr>
                    )
                  : data.oauth_tokens.map(token => (
                      <tr key={token.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-300">
                          {token.id.slice(0, 12)}
                          ...
                        </td>
                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">{token.userId}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{token.clientId}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{token.scope}</td>
                        <td className="px-4 py-3 text-gray-400">{new Date(token.expiresAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => revokeMutation.mutate(token.id)}
                            disabled={revokeMutation.isPending}
                            className="px-2 py-1 text-xs bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 rounded transition-colors disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="text-lg font-medium text-gray-200 mb-4">
            User Tokens (
            {data?.user_tokens.length ?? 0}
            )
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!data?.user_tokens.length
                  ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No user tokens</td></tr>
                    )
                  : data.user_tokens.map(token => (
                      <tr key={token.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-300">
                          {token.id.slice(0, 12)}
                          ...
                        </td>
                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">{token.userId}</td>
                        <td className="px-4 py-3 text-gray-300">{token.name}</td>
                        <td className="px-4 py-3 text-gray-400">{new Date(token.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => revokeMutation.mutate(token.id)}
                            disabled={revokeMutation.isPending}
                            className="px-2 py-1 text-xs bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 rounded transition-colors disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
