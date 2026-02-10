# GIM 系统架构文档

> 版本: 0.1.0-beta.1 | 最后更新: 2026-02

## 1. 项目概述

GIM 是一个基于 Matrix 协议的即时通讯服务端实现，采用现代 TypeScript 技术栈构建。项目目标是提供一个轻量级、易部署的 Matrix homeserver，支持完整的端到端加密（E2EE）、同步协议和管理面板。

### 技术栈

| 层次 | 技术选型 | 选型理由 |
|------|----------|----------|
| 运行时 | Bun | 高性能 JS 运行时，内置 SQLite、测试框架 |
| HTTP 框架 | Hono | 轻量高性能，API 设计友好 |
| ORM | Drizzle ORM | 类型安全，零运行时开销，SQLite 原生支持 |
| 数据库 | SQLite (WAL) | 单进程部署简单，零运维，适合中小规模 |
| 缓存 | unstorage | 抽象层支持内存/Redis 双驱动 |
| 验证 | Zod v4 | 运行时类型校验，与 TypeScript 深度集成 |
| 日志 | Winston | 结构化日志，多格式输出 |
| 定时任务 | Croner | 轻量 Cron 调度器 |
| 对象存储 | AWS SDK (S3/R2) | 兼容 Cloudflare R2 |
| 管理面板 | React 19 + TanStack + Tailwind v4 | 现代 SPA 技术栈 |

---

## 2. 系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端层                              │
│  Matrix 客户端 (Element, FluffyChat 等)  |  Admin SPA       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│                     HTTP 入口 (Hono)                         │
│  ┌─────────┐ ┌──────┐ ┌──────────┐ ┌───────────┐           │
│  │RequestID│→│ CORS │→│RequestLog│→│ RateLimit │           │
│  └─────────┘ └──────┘ └──────────┘ └───────────┘           │
│                       ↓                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              路由分发层                                │   │
│  │  /.well-known/*  /_matrix/client/*  /oauth/*         │   │
│  │  /_matrix/media/*  /admin/api/*  /admin/*            │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                     业务模块层                               │
│  ┌────────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌──────┐          │
│  │  auth  │ │ room │ │message│ │ sync │ │ e2ee │          │
│  └────────┘ └──────┘ └───────┘ └──────┘ └──────┘          │
│  ┌────────┐ ┌──────┐ ┌───────┐ ┌────────┐ ┌──────┐        │
│  │account │ │device│ │ media │ │presence│ │notify│        │
│  └────────┘ └──────┘ └───────┘ └────────┘ └──────┘        │
│  ┌────────┐ ┌──────┐                                       │
│  │ admin  │ │server│                                       │
│  └────────┘ └──────┘                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                     基础设施层                               │
│  ┌─────────┐  ┌───────────┐  ┌──────┐  ┌──────┐           │
│  │ Drizzle │  │EventEmitter│  │Cache │  │ S3   │           │
│  │ SQLite  │  │ (Notifier) │  │层    │  │ /R2  │           │
│  └─────────┘  └───────────┘  └──────┘  └──────┘           │
│  ┌─────────┐  ┌───────────┐                                │
│  │  Cron   │  │  OAuth/   │                                │
│  │  Jobs   │  │  OIDC     │                                │
│  └─────────┘  └───────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 请求处理流程

### 3.1 中间件栈（执行顺序）

```
请求进入
  │
  ├─ 1. requestIdMiddleware    注入 X-Request-Id（提取或生成 UUID）
  │                            记录请求开始时间
  ├─ 2. CORS                   处理跨域请求（可配置 origins）
  │
  ├─ 3. requestLogMiddleware   请求完成后记录结构化日志
  │                            区分正常/长轮询/错误的日志级别
  ├─ 4. rateLimitMiddleware    滑动窗口限流（600 次/分钟/IP）
  │                            仅应用于 /_matrix/* 和 /oauth/*
  │
  ├─ 5. authMiddleware         按路由选择性应用
  │    (可选)                   Bearer Token → OAuth 表 → accountTokens 表
  │                            注入 AuthContext {userId, deviceId, isGuest}
  │                            每请求更新设备 lastSeenAt
  │
  └─ 6. 路由处理器              业务逻辑处理
```

### 3.2 认证流程

```
┌─────────┐        ┌──────────┐       ┌──────────────┐
│ Matrix   │  SSO   │  GIM     │ OIDC  │  上游 OIDC   │
│ 客户端   │ ─────→ │  OAuth   │ ────→ │  (login.gid  │
│          │        │  Provider│       │   .io)       │
└─────────┘        └──────────┘       └──────────────┘
     │                   │                    │
     │  1. GET /login    │                    │
     │←─ 返回登录方式 ───│                    │
     │                   │                    │
     │  2. SSO redirect  │                    │
     │──────────────────→│  3. 重定向到上游    │
     │                   │───────────────────→│
     │                   │                    │
     │                   │  4. 用户登录后回调   │
     │                   │←───────────────────│
     │                   │                    │
     │  5. 回调 + code   │  6. 换取 token     │
     │←──────────────────│───────────────────→│
     │                   │                    │
     │  7. LoginToken    │  8. 用户信息       │
     │←──────────────────│←───────────────────│
     │                   │                    │
     │  9. POST /login   │                    │
     │  (m.login.token)  │                    │
     │──────────────────→│                    │
     │                   │                    │
     │  10. AccessToken  │                    │
     │  + RefreshToken   │                    │
     │←──────────────────│                    │
```

**Token 类型与生命周期：**

| Token 类型 | 有效期 | 用途 | 是否一次性 |
|-----------|--------|------|-----------|
| Grant | 14 天 | 代表用户授权 | 否 |
| AuthorizationCode | 1 分钟 | PKCE 授权码 | 是 |
| AccessToken | 24 小时 | API 访问凭证 (JWT) | 否 |
| RefreshToken | 14 天 | 刷新 AccessToken | 是（轮换） |
| LoginToken | 2 分钟 | SSO 登录桥接 | 是 |
| AccountToken | 永久 | 长期 Bot Token | 否 |

---

## 4. 模块架构

### 4.1 模块组织规范

每个功能模块位于 `app/modules/{name}/`，遵循统一结构：

```
app/modules/{name}/
├── routes.ts        # Hono 路由处理器（必须）
├── service.ts       # 业务逻辑层（按需）
└── middleware.ts     # 模块专用中间件（少见）
```

### 4.2 模块依赖关系

```
                    ┌──────────┐
                    │  server  │  (无依赖，提供 well-known/versions)
                    └──────────┘

┌──────┐    ┌──────────┐    ┌─────────┐
│ auth │───→│  oauth   │───→│ account │
└──────┘    └──────────┘    └─────────┘
   │                            │
   ▼                            ▼
┌──────┐    ┌──────────┐    ┌─────────┐
│device│◄──→│   e2ee   │    │  room   │
└──────┘    └──────────┘    └─────────┘
                │               │
                ▼               ▼
            ┌──────┐      ┌─────────┐
            │ sync │◄────→│ message │
            └──────┘      └─────────┘
               ▲               │
               │               ▼
          ┌────────┐    ┌──────────────┐
          │presence│    │ notification │
          └────────┘    └──────────────┘

          ┌──────┐      ┌───────┐
          │admin │      │ media │  (独立模块)
          └──────┘      └───────┘
```

### 4.3 各模块职责

| 模块 | 路由前缀 | 职责 | 关键数据表 |
|------|---------|------|-----------|
| **server** | `/.well-known/*` | 服务发现、版本、能力声明 | 无 |
| **auth** | `/_matrix/client/v3/login\|logout\|register` | 登录/登出/SSO | oauthTokens |
| **account** | `/_matrix/client/v3/user/*` | 用户资料、账号数据、推送规则 | accounts, accountData, accountTokens |
| **device** | `/_matrix/client/v3/devices/*` | 设备管理、删除级联 | devices |
| **room** | `/_matrix/client/v3/createRoom\|join\|rooms/*` | 房间生命周期、成员管理、别名 | rooms, roomMembers, roomAliases |
| **message** | `/_matrix/client/v3/rooms/*/send\|state\|messages` | 消息发送、状态事件、已读回执 | eventsTimeline, eventsState, currentRoomState |
| **e2ee** | `/_matrix/client/v3/keys/*\|sendToDevice` | 密钥上传/查询/认领、设备间消息 | e2ee* (6 张表) |
| **sync** | `/_matrix/client/v3/sync` | 长轮询同步、增量更新 | 读取多张表 |
| **media** | `/_matrix/media/v3/*` | 文件上传/下载、配额管理 | media, mediaDeletions |
| **presence** | `/_matrix/client/v3/presence/*` | 在线状态管理 | presence |
| **notification** | `/_matrix/client/v3/notifications` | 推送通知记录与查询 | pushNotifications, pushRules |
| **admin** | `/admin/api/*` | 管理面板 API | 读取多张表 |
| **oauth** | `/oauth/*` | OIDC Provider (MSC2965) | oauthTokens |

---

## 5. 同步机制

### 5.1 长轮询同步架构

```
客户端                    Sync 路由                  Notifier              数据库
  │                         │                         │                     │
  │  GET /sync?timeout=28s  │                         │                     │
  │────────────────────────→│                         │                     │
  │                         │  waitForNotification()  │                     │
  │                         │────────────────────────→│                     │
  │                         │                         │                     │
  │                         │    (阻塞等待事件        │                     │
  │                         │     或超时)             │                     │
  │                         │                         │                     │
  │                         │                      ┌──┤ 其他请求写入事件     │
  │                         │                      │  │────────────────────→│
  │                         │                      │  │  notifyUser(userId) │
  │                         │                      │  │←────────────────────│
  │                         │  emit('notify:userId')  │                     │
  │                         │←────────────────────────│                     │
  │                         │                         │                     │
  │                         │  buildSyncResponse()    │                     │
  │                         │─────────────────────────────────────────────→│
  │                         │                         │    查询增量数据      │
  │                         │←─────────────────────────────────────────────│
  │                         │                         │                     │
  │   Sync Response         │                         │                     │
  │←────────────────────────│                         │                     │
```

### 5.2 Sync 响应结构

```json
{
  "next_batch": "ULID_TOKEN",
  "rooms": {
    "join": {
      "!roomId": {
        "timeline": { "events": [], "limited": false, "prev_batch": "" },
        "state": { "events": [] },
        "account_data": { "events": [] },
        "ephemeral": { "events": [] },
        "summary": { "m.joined_member_count": 0 },
        "unread_notifications": { "notification_count": 0, "highlight_count": 0 }
      }
    },
    "invite": {},
    "leave": {}
  },
  "to_device": { "events": [] },
  "device_lists": { "changed": [], "left": [] },
  "device_one_time_keys_count": {},
  "device_unused_fallback_key_types": []
}
```

### 5.3 Notifier 实现

- 基于 Node.js `EventEmitter`，事件名格式: `notify:{userId}`
- 每个长轮询持有唯一 `syncKey`（自增计数器）
- 多设备并发 sync 不互相取消
- **限制：仅支持单进程部署**——多进程需替换为 Redis Pub/Sub

---

## 6. 事件存储模型

### 6.1 双表设计

```
事件写入
  │
  ├─ 类型有 stateKey ──→ eventsState（状态事件表）
  │                       同时更新 currentRoomState（当前状态物化表）
  │
  └─ 普通消息 ──────────→ eventsTimeline（时间线事件表）
```

**设计理由：**
- 状态事件需要按 `(type, stateKey)` 快速查询当前值
- 时间线事件需要按时间顺序分页查询
- 分离后各表可独立优化索引策略

### 6.2 事件 ID 与排序

- 事件 ID 使用 **ULID**（单调递增），作为主键和排序键
- To-device 消息使用 **auto-increment integer**（不用 ULID，保证严格顺序）
- `next_batch` 取 `max(最新事件ULID, 最新设备列表变更ULID)`

---

## 7. E2EE 架构

### 7.1 密钥体系

```
用户
 └─ 设备
     ├─ 身份密钥 (Identity Keys)
     │   ├─ curve25519（密钥协商）
     │   └─ ed25519（签名）
     │
     ├─ 一次性密钥 (OTKs)
     │   └─ signed_curve25519:{keyId} → keyJson
     │
     ├─ 备用密钥 (Fallback Keys)
     │   └─ 每算法一个，OTK 耗尽时使用
     │
     └─ 交叉签名密钥 (Cross-signing)
         ├─ master（主密钥）
         ├─ self_signing（自签名密钥）
         └─ user_signing（用户签名密钥）
```

### 7.2 密钥变更流程

```
设备上传新身份密钥
  │
  ├─ 1. 清除旧 OTKs
  ├─ 2. 清除旧 Fallback Keys
  ├─ 3. 清除旧 Cross-signing Keys
  ├─ 4. 清除过期 To-device 消息
  ├─ 5. 重置 lastToDeviceStreamId = 0
  ├─ 6. 设置 pendingKeyChange = true
  │
  └─ 上传新 OTKs 时
      ├─ 设置 pendingKeyChange = false
      ├─ 插入 deviceListChanges 记录
      └─ 通知共享房间的所有成员
```

---

## 8. 定时任务

| 任务 | 频率 | 功能 |
|------|------|------|
| cleanupOrphanedE2eeKeys | 启动时 + 每 6 小时 | 清理无对应设备的 E2EE 密钥 |
| cleanupExpiredTokens | 启动时 + 每 6 小时 | 清理过期 OAuth Token |
| processMediaDeletions | 每 5 分钟 | 处理媒体软删除队列（S3/本地） |
| expirePresence | 每 1 分钟 | 过期不活跃用户的在线状态 |

---

## 9. 管理面板架构

```
admin/
├── src/
│   ├── main.tsx          # React 入口
│   ├── router.tsx        # TanStack Router 路由定义
│   ├── api.ts            # fetch 封装（Bearer Token 认证）
│   ├── components/
│   │   └── Layout.tsx    # 侧边栏布局
│   └── routes/
│       ├── dashboard.tsx # 统计概览
│       ├── users.tsx     # 用户列表（搜索、分页）
│       ├── user-detail   # 用户详情（设备、房间、操作）
│       ├── rooms.tsx     # 房间列表
│       ├── room-detail   # 房间详情（成员）
│       ├── media.tsx     # 媒体管理（删除）
│       ├── tokens.tsx    # Token 管理（吊销）
│       └── login.tsx     # 管理员登录
```

**认证方式：** 长期 AccountToken 存储在 localStorage，通过 `/admin/api/*` 认证。

**开发/生产模式：**
- 开发：Vite dev server (5173) 代理 API 到主服务 (3000)
- 生产：构建为静态文件，由主服务 `/admin/*` 路径提供

---

## 10. 目录结构总览

```
gim/
├── app/                          # 服务端源码
│   ├── index.ts                  # 入口：Hono 应用、路由挂载、优雅关闭
│   ├── config.ts                 # 环境变量配置中心
│   ├── global.ts                 # Winston 日志、全局类型声明
│   ├── cron.ts                   # 定时任务调度
│   ├── db/
│   │   ├── index.ts              # SQLite 连接、Drizzle ORM 初始化
│   │   └── schema.ts             # 完整数据库 Schema（27 张表）
│   ├── cache/
│   │   └── index.ts              # unstorage 缓存抽象层
│   ├── oauth/
│   │   ├── provider.ts           # OIDC Provider（MSC2965）
│   │   ├── tokens.ts             # Token 签发与管理
│   │   └── account.ts            # 用户自动创建
│   ├── modules/                  # 12 个业务模块
│   │   ├── account/routes.ts
│   │   ├── admin/{routes,middleware}.ts
│   │   ├── auth/routes.ts
│   │   ├── device/routes.ts
│   │   ├── e2ee/routes.ts
│   │   ├── media/routes.ts
│   │   ├── message/{routes,service}.ts
│   │   ├── notification/{routes,service}.ts
│   │   ├── presence/{routes,service}.ts
│   │   ├── room/{routes,service}.ts
│   │   ├── server/routes.ts
│   │   └── sync/{routes,service,notifier}.ts
│   ├── shared/
│   │   ├── middleware/           # 通用中间件
│   │   ├── helpers/              # 事件查询、格式化、权限检查
│   │   ├── validation.ts         # Zod 校验 Schema
│   │   └── metrics.ts            # 请求计数器
│   └── utils/
│       ├── tokens.ts             # ID 生成器（ULID、nanoid）
│       ├── s3.ts                 # S3/R2 操作封装
│       └── storage.ts            # 缓存工具
├── admin/                        # 管理面板 SPA
├── tests/                        # BDD 集成测试
├── examples/                     # API 使用示例（10 个场景）
├── tools/                        # CLI 工具
├── drizzle/                      # 数据库迁移文件
└── data/                         # SQLite 数据文件
```
