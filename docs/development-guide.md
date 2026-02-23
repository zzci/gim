# GIM 开发指南

> 版本: 0.4.0 | 最后更新: 2026-02-11

## 1. 环境准备

### 1.1 前置依赖

| 工具 | 版本要求 | 用途 |
|------|---------|------|
| Bun | >= 1.0 | 运行时、包管理、测试、SQLite |
| Node.js | >= 18（可选） | 部分 npm 脚本兼容 |
| Git | 任意 | 版本控制 |

### 1.2 初始设置

```bash
# 1. 克隆项目
git clone <repo-url>
cd gim

# 2. 安装依赖
bun install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，至少设置:
#   IM_SERVER_NAME=localhost
#   IM_OIDC_CLIENT_ID=<你的 OIDC client ID>
#   IM_OIDC_CLIENT_SECRET=<你的 OIDC client secret>

# 4. 初始化数据库
bun run db:push    # 开发环境直接同步 schema
# 注意: 服务启动时会自动执行 drizzle 迁移（auto-migrate）

# 5. 启动开发服务器
bun run dev        # 启动在 http://localhost:3000
```

### 1.3 管理面板开发

```bash
# 终端 1: 启动后端服务
bun run dev

# 终端 2: 启动前端开发服务器
bun run admin:dev   # 启动在 http://localhost:5173/admin/
                    # 自动代理 /admin/api → localhost:3000
```

### 1.4 测试数据准备

```bash
# 创建测试用户 (alice, bob) 并生成 token
bun run examples:setup

# 将用户提升为管理员
bun run admin:create @alice:localhost

# 运行集成测试
bun test

# 运行示例脚本（验证所有 API）
bun run examples:test
```

---

## 2. 项目结构与约定

### 2.1 目录规范

```
app/
├── modules/{name}/          # 功能模块
│   ├── routes.ts            # 路由处理器（必须）
│   ├── service.ts           # 业务逻辑（按需）
│   └── middleware.ts         # 模块中间件（少见）
├── shared/
│   ├── middleware/           # 全局中间件
│   ├── helpers/              # 通用帮助函数
│   └── validation.ts         # Zod 校验 Schema
├── db/
│   ├── schema.ts             # 数据库 Schema（单文件）
│   └── index.ts              # DB 连接初始化
├── oauth/                    # OIDC Provider
├── cache/                    # 缓存抽象层
└── utils/                    # 工具函数
```

### 2.2 代码风格

**ESLint 配置（@antfu/eslint-config）：**
- 不使用分号
- 使用单引号
- 尾逗号
- 2 空格缩进

```bash
bun run lint       # 检查
bun run lint:fix   # 自动修复
```

**TypeScript 规范：**
- strict 模式
- `noUncheckedIndexedAccess: true` — 索引访问返回 `T | undefined`
- 使用 `@/*` 路径别名指向 `app/*`

```typescript
// ✅ 正确
import { db } from '@/db'
import { accounts } from '@/db/schema'

// ❌ 错误
import { db } from '../../db'
```

### 2.3 ID 生成约定

| 用途 | 函数 | 格式 | 位置 |
|------|------|------|------|
| 事件 ID | `generateEventId()` → `generateUlid()` | ULID | app/utils/tokens.ts |
| 房间 ID | `generateRoomId()` | `!{shortId}:{serverName}` | app/utils/tokens.ts |
| 媒体 ID | `generateMediaId()` → `generateUlid()` | ULID | app/utils/tokens.ts |
| 设备 ID | `generateDeviceId()` → `generateShortId()` | 8 字符 nanoid | app/utils/tokens.ts |
| 请求 ID | UUID | UUID v4 | middleware/requestId.ts |
| To-device 消息 | auto-increment | 整数 | 数据库自增 |

### 2.4 错误响应约定

所有错误响应使用 Matrix 标准格式：

```typescript
import { matrixError, matrixForbidden, matrixNotFound } from '@/shared/middleware/errors'

// 通用错误
return matrixError(c, 'M_INVALID_PARAM', '参数无效')

// 404
return matrixNotFound(c, '资源不存在')

// 403
return matrixForbidden(c, '无权限')
```

常用错误码：

| 错误码 | HTTP 状态 | 场景 |
|--------|----------|------|
| M_FORBIDDEN | 403 | 权限不足 |
| M_NOT_FOUND | 404 | 资源不存在 |
| M_UNKNOWN_TOKEN | 401 | Token 无效/过期 |
| M_MISSING_TOKEN | 401 | 未提供 Token |
| M_BAD_JSON | 400 | JSON 格式错误 |
| M_INVALID_PARAM | 400 | 参数不合法 |
| M_LIMIT_EXCEEDED | 429 | 频率限制 |
| M_TOO_LARGE | 413 | 请求体过大 |

---

## 3. 开发模式

### 3.1 新增 API 端点

**步骤：**

1. **确定模块归属** — 找到或创建 `app/modules/{name}/`
2. **定义路由** — 在 `routes.ts` 中添加路由处理器
3. **添加认证** — 使用 `authMiddleware` 保护需要认证的端点
4. **请求验证** — 使用 Zod schema 验证请求体
5. **注册路由** — 在 `app/index.ts` 中挂载

```typescript
import type { AuthEnv } from '@/shared/middleware/auth'
// app/modules/example/routes.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '@/db'
import { authMiddleware } from '@/shared/middleware/auth'
import { matrixError, matrixNotFound } from '@/shared/middleware/errors'
import { validate } from '@/shared/validation'

const app = new Hono<AuthEnv>()

// 公开端点（无需认证）
app.get('/public', async (c) => {
  return c.json({ status: 'ok' })
})

// 受保护端点
app.use('/*', authMiddleware)

const createSchema = z.object({
  name: z.string().max(255),
})

app.post('/create', async (c) => {
  const body = await c.req.json()
  const v = validate(c, createSchema, body)
  if (!v.success)
    return v.response

  const { userId } = c.get('auth')
  // 业务逻辑...

  return c.json({ id: 'new-id' })
})

export { app as exampleRoutes }
```

### 3.2 新增数据库表

1. 在 `app/db/schema.ts` 添加表定义
2. 运行 `bun run db:generate` 生成迁移
3. 运行 `bun run db:migrate` 执行迁移
4. 开发环境可用 `bun run db:push` 跳过迁移文件

```typescript
// app/db/schema.ts
export const reactions = sqliteTable('reactions', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  key: text('key').notNull(), // emoji 或自定义 reaction
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date()),
}, table => [
  index('idx_reactions_event').on(table.eventId),
  index('idx_reactions_user').on(table.userId),
])
```

### 3.3 事件通知模式

当操作需要触发同步更新时，使用 notifier：

```typescript
import { notifyUser } from '@/modules/sync/notifier'

// 通知单个用户有新数据
notifyUser(userId)

// 通知房间内所有成员
const members = await db.select()
  .from(roomMembers)
  .where(eq(roomMembers.roomId, roomId))
for (const member of members) {
  notifyUser(member.userId)
}
```

### 3.4 事件创建模式

使用 `createEvent()` 创建 Matrix 事件（会自动处理 currentRoomState 更新和媒体关联）：

```typescript
import { createEvent } from '@/modules/message/service'

// 创建时间线事件
const event = await createEvent({
  roomId,
  sender: userId,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: 'Hello' },
})

// 创建状态事件
const stateEvent = await createEvent({
  roomId,
  sender: userId,
  type: 'm.room.name',
  stateKey: '',
  content: { name: 'New Room Name' },
})
```

---

## 4. 测试

### 4.1 测试架构

```
tests/
├── helpers.ts        # 客户端工厂、token 加载
├── server.test.ts    # 服务发现、协议基础
├── rooms.test.ts     # 房间生命周期
├── messages.test.ts  # 消息操作
├── state.test.ts     # 状态事件
├── devices.test.ts   # 设备 + E2EE 密钥
├── sync.test.ts      # 同步协议
└── notifications.test.ts  # 推送通知
```

### 4.2 运行测试

```bash
# 前提：服务器运行中 + 已执行 examples:setup
bun run dev &
bun run examples:setup

# 运行全部测试
bun test

# 运行单个测试文件
bun test tests/rooms.test.ts

# 运行匹配的测试
bun test --grep "should create room"
```

### 4.3 编写测试

```typescript
// tests/example.test.ts
import { describe, expect, test } from 'bun:test'
import { getAlice, getBob, txnId } from './helpers'

describe('Example Feature', () => {
  test('should do something', async () => {
    const alice = getAlice()

    const res = await alice.createRoom({ name: 'Test Room' })
    expect(res.room_id).toBeDefined()

    // 清理
    await alice.leaveRoom(res.room_id)
  })
})
```

### 4.4 集成示例

`examples/` 目录包含完整的 API 使用示例：

```bash
# 运行单个示例
bun run examples/01-sync.ts

# 运行全部示例
bun run examples:test
```

每个示例是独立的端到端场景，可用于验证 API 正确性。

---

## 5. 数据库操作

### 5.1 常用查询模式

```typescript
import { db } from '@/db'
import { accounts, rooms, roomMembers } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'

// 单行查询
const user = await db.select().from(accounts)
  .where(eq(accounts.id, userId))
  .get()

// 条件查询
const members = await db.select().from(roomMembers)
  .where(and(
    eq(roomMembers.roomId, roomId),
    eq(roomMembers.membership, 'join'),
  ))
  .all()

// Upsert
await db.insert(accountData)
  .values({ userId, type, roomId: '', content })
  .onConflictDoUpdate({
    target: [accountData.userId, accountData.type, accountData.roomId],
    set: { content },
  })

// 事务
await db.transaction(async (tx) => {
  await tx.insert(eventsTimeline).values(event)
  await tx.update(currentRoomState)
    .set({ eventId: event.id })
    .where(...)
})
```

### 5.2 数据库工具

```bash
# 可视化浏览器（端口 3000，确保主服务未运行）
bun run db:studio

# 直接查看数据库
sqlite3 data/gim.db ".tables"
sqlite3 data/gim.db "SELECT * FROM accounts LIMIT 10"
```

---

## 6. 环境变量参考

| 变量 | 默认值 | 必填 | 说明 |
|------|--------|------|------|
| `NODE_ENV` | — | 否 | dev/production |
| `IM_SERVER_NAME` | localhost | 是 | Matrix 服务域名 |
| `IM_PORT` | 3000 | 否 | 监听端口 |
| `IM_HOST` | 0.0.0.0 | 否 | 绑定地址 |
| `IM_COOKIE_SECRET` | dev-cookie-secret | 生产必填 | Cookie 签名密钥 |
| `IM_CORS_ORIGINS` | * | 否 | 允许的跨域来源 |
| `IM_OIDC_ISSUER` | https://login.gid.io/oidc | 是 | 上游 OIDC 发行者 |
| `IM_OIDC_CLIENT_ID` | — | 是 | OIDC Client ID |
| `IM_OIDC_CLIENT_SECRET` | — | 是 | OIDC Client Secret |
| `DB_PATH` | data/gim.db | 否 | SQLite 文件路径 |
| `IM_CACHE_DRIVER` | memory | 否 | 缓存驱动 (memory/redis) |
| `IM_ACCOUNT_TOKEN_CACHE_MAX_TTL_SEC` | 7200 | 否 | account token 缓存最大 TTL（秒） |
| `IM_ACCOUNT_TOKEN_VALIDITY_SEC` | 0 | 否 | account token 有效期（秒，0=不过期） |
| `IM_OAUTH_ACCESS_TOKEN_CACHE_MAX_TTL_SEC` | 3600 | 否 | OAuth access token 缓存最大 TTL（秒） |
| `IM_LOG_FORMAT` | 自动 | 否 | 日志格式 (json/cli) |
| `IM_LOG_LEVEL` | 自动 | 否 | 日志级别 (error/warn/info/http/verbose/debug/silly) |
| `IM_MAX_ROOM_MEMBERS` | 0 | 否 | 房间成员上限 (0=无限) |
| `IM_MAX_ROOMS_PER_USER` | 0 | 否 | 每用户房间上限 (0=无限) |
| `IM_MEDIA_QUOTA_MB` | 0 | 否 | 媒体配额 MB (0=无限) |
| `IM_MEDIA_UPLOADS_PER_HOUR` | 0 | 否 | 每小时上传限制 (0=无限) |
| `IM_PUSH_GATEWAY_URL` | — | 否 | 服务级默认推送网关 URL |
| `IM_AS_REGISTRATION_DIR` | data/appservices | 否 | Application Service 注册 YAML 目录 |
| `IM_TURN_URIS` | — | 否 | TURN 服务器 URI（逗号分隔） |
| `IM_TURN_SHARED_SECRET` | — | 否 | TURN 共享密钥（HMAC-SHA1） |
| `IM_TURN_TTL` | 86400 | 否 | TURN 凭证有效期（秒） |
| `IM_LIVEKIT_SERVICE_URL` | — | 否 | LiveKit JWT 服务 URL（MatrixRTC） |
| `REDIS_URL` | — | 仅 redis 驱动 | Redis 连接地址 |
| `S3_ACCOUNT_ID` | — | 否 | S3/R2 账号 ID |
| `S3_BUCKET_NAME` | — | 否 | S3 桶名称 |
| `S3_ACCESS_KEY_ID` | — | 否 | S3 访问密钥 |
| `S3_SECRET_ACCESS_KEY` | — | 否 | S3 秘密密钥 |
| `S3_REGION` | auto | 否 | S3 区域 |
| `S3_PUBLIC_URL` | — | 否 | 自定义 S3 公网 URL |

---

## 7. 常见问题

### Q: `bun --hot` 改了代码但没生效？
重启服务。`bun --hot` 对某些模块级副作用（特别是 E2EE 相关）可能无法正确热更新。

### Q: 数据库被锁？
SQLite 单写锁。检查是否有其他进程（如 db:studio）占用。使用 `lsof data/gim.db` 定位。

### Q: 如何查看数据库？
`bun run db:studio` 启动 Drizzle Studio 可视化浏览器（注意会占用 3000 端口）。

### Q: 测试报 token 无效？
重新运行 `bun run examples:setup` 生成新 token。Token 存在 `examples/.tokens.json`。

### Q: 管理面板 API 403？
确保用户已被提升为管理员：`bun run admin:create @user:localhost`。

### Q: S3 上传失败？
检查 `.env` 中 S3 相关变量是否全部正确配置。缺少任一变量会回退到本地存储。
