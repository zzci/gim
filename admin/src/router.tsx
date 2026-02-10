import { createRootRoute, createRoute } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { AuditLogPage } from './routes/audit-log'
import { DashboardPage } from './routes/dashboard'
import { LoginPage } from './routes/login'
import { MediaPage } from './routes/media'
import { RoomDetailPage } from './routes/room-detail'
import { RoomsPage } from './routes/rooms'
import { TokensPage } from './routes/tokens'
import { UserDetailPage } from './routes/user-detail'
import { UsersPage } from './routes/users'

const rootRoute = createRootRoute({ component: Layout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: UsersPage,
})

const userDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users/$userId',
  component: UserDetailPage,
})

const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  component: RoomsPage,
})

const roomDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId',
  component: RoomDetailPage,
})

const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/media',
  component: MediaPage,
})

const tokensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tokens',
  component: TokensPage,
})

const auditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit-log',
  component: AuditLogPage,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  usersRoute,
  userDetailRoute,
  roomsRoute,
  roomDetailRoute,
  mediaRoute,
  tokensRoute,
  auditLogRoute,
])
