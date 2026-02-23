import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { adminLogin } from '../api'

export function LoginPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim())
      return

    setError('')
    setLoading(true)
    try {
      const ok = await adminLogin(token.trim())
      if (ok) {
        navigate({ to: '/' })
      }
      else {
        setError('Invalid token or not an admin')
      }
    }
    catch {
      setError('Login failed')
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-white mb-6 text-center">gim admin</h1>
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-300 mb-1.5">
              Admin Token
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Enter your admin token"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-md transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
