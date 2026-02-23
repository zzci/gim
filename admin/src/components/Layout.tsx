import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { adminLogout, hasDevToken } from '../api'

const navItems = [
  { to: '/' as const, label: 'Dashboard' },
  { to: '/users' as const, label: 'Users' },
  { to: '/rooms' as const, label: 'Rooms' },
  { to: '/media' as const, label: 'Media' },
  { to: '/tokens' as const, label: 'Tokens' },
  { to: '/audit-log' as const, label: 'Audit Log' },
]

export function Layout() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const isLoginPage = pathname === '/admin/login'
  const [authenticated, setAuthenticated] = useState(hasDevToken())

  useEffect(() => {
    if (isLoginPage)
      return
    // Check auth by making a lightweight API call
    fetch('/admin/api/stats', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) {
          setAuthenticated(false)
          navigate({ to: '/login' })
        }
        else {
          setAuthenticated(true)
        }
      })
      .catch(() => {
        setAuthenticated(false)
        navigate({ to: '/login' })
      })
  }, [isLoginPage, navigate])

  if (isLoginPage || !authenticated) {
    return <Outlet />
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-800">
          <h1 className="text-lg font-semibold tracking-tight text-white">gim admin</h1>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className="block px-3 py-2 rounded-md text-sm font-medium transition-colors"
              activeProps={{ className: 'bg-gray-800 text-white' }}
              inactiveProps={{ className: 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={async () => {
              await adminLogout()
              navigate({ to: '/login' })
            }}
            className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors text-left"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
