import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

const navItems = [
  { to: '/' as const, label: 'Dashboard' },
  { to: '/users' as const, label: 'Users' },
  { to: '/rooms' as const, label: 'Rooms' },
  { to: '/media' as const, label: 'Media' },
  { to: '/tokens' as const, label: 'Tokens' },
]

export function Layout() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const isLoginPage = pathname === '/admin/login'
  const hasToken = !!localStorage.getItem('admin_token')

  useEffect(() => {
    if (!hasToken && !isLoginPage) {
      navigate({ to: '/login' })
    }
  }, [hasToken, isLoginPage, navigate])

  if (isLoginPage) {
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
            onClick={() => {
              localStorage.removeItem('admin_token')
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
