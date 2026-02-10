# GIM 扩展性与可伸缩性分析

> 版本: 0.1.0-beta.1 | 最后更新: 2026-02

## 1. 当前架构的扩展性评估

### 1.1 扩展性得分

| 维度 | 评分 | 说明 |
|------|------|------|
| 模块化 | ⭐⭐⭐⭐ | 模块边界清晰，routes/service 分层合理 |
| 水平扩展 | ⭐⭐ | 强依赖进程内状态，无法直接多进程部署 |
| 垂直扩展 | ⭐⭐⭐ | SQLite WAL 支持并发读，但单写锁是瓶颈 |
| 功能扩展 | ⭐⭐⭐⭐ | 新模块可独立添加，路由挂载简单 |
| 协议兼容 | ⭐⭐⭐ | 覆盖 Matrix CS API 核心部分，部分 MSC 支持 |

### 1.2 扩展性瓶颈

#### 瓶颈 1：进程内状态（最大限制）

以下组件强依赖单进程内存，阻止水平扩展：

| 组件 | 位置 | 状态类型 |
|------|------|---------|
| Sync Notifier | `sync/notifier.ts` | EventEmitter 事件通知 |
| SSO States | `auth/routes.ts` | PKCE state + codeVerifier |
| OAuth Auth States | `oauth/provider.ts` | 上游 OIDC 流程状态 |
| Rate Limiter | `shared/middleware/rateLimit.ts` | IP 请求计数 |
| Media Upload Windows | `media/routes.ts` | 上传频率限制 |

#### 瓶颈 2：SQLite 写入锁

SQLite 支持并发读（WAL 模式），但写入是单线程串行的。在高写入场景下（频繁消息发送、设备更新），写入锁将成为瓶颈。

#### 瓶颈 3：同步查询复杂度

每次同步请求需要：
- 查询用户所有房间的增量事件
- 计算每个房间的未读数
- 查询 to-device 消息
- 查询设备列表变更
- 查询在线状态

房间数量 × 查询次数 = O(n) 数据库访问，无批量优化。

---

## 2. 水平扩展路径

### 2.1 阶段 1：状态外部化（支持多进程）

**目标：** 允许在同一台机器上运行多个 Bun 进程

```
变更前:                         变更后:
┌─────────┐                    ┌─────────┐  ┌─────────┐
│ Bun     │                    │ Bun #1  │  │ Bun #2  │
│ 进程    │                    │         │  │         │
│ ┌─────┐ │                    └────┬────┘  └────┬────┘
│ │Event│ │                         │            │
│ │Emit │ │                    ┌────▼────────────▼────┐
│ └─────┘ │                    │    Redis Pub/Sub     │
│ ┌─────┐ │                    │    + Cache           │
│ │Rate │ │                    └─────────────────────┘
│ │Limit│ │
│ └─────┘ │
└─────────┘
```

**所需变更：**

1. **Notifier → Redis Pub/Sub**
   - 替换 EventEmitter 为 Redis `SUBSCRIBE/PUBLISH`
   - 通道格式保持 `notify:{userId}`
   - unstorage 已有 Redis 驱动，可复用连接

2. **Rate Limiter → Redis**
   - 使用 Redis `INCR` + `EXPIRE` 实现分布式滑动窗口
   - 或使用 unstorage 存储计数

3. **Auth States → Redis**
   - SSO 流程状态存入 Redis（带 TTL）
   - OAuth 授权状态存入 Redis

4. **Media Rate Limit → Redis**
   - 上传频率窗口存入 Redis

### 2.2 阶段 2：数据库升级（支持高并发）

**SQLite → PostgreSQL 迁移路径：**

Drizzle ORM 同时支持 SQLite 和 PostgreSQL，迁移成本较低：

| 步骤 | 工作量 | 说明 |
|------|--------|------|
| schema.ts 适配 | 中 | 类型映射：`text` → `text`，`integer` → `integer`，JSON → `jsonb` |
| raw SQL 迁移 | 低 | 仅 cron.ts 中 4 处 raw SQL |
| 连接池配置 | 低 | Drizzle 内置 pg 连接池支持 |
| ULID 排序 | 无变更 | ULID 文本排序在 PG 中同样有效 |
| WAL pragma | 移除 | PG 不需要 |

**暂缓原因：**
- 当前用户规模 SQLite 完全够用
- 增加部署复杂度（需要独立 PG 实例）
- 迁移工具链尚未准备

### 2.3 阶段 3：微服务拆分（仅在必要时）

如果单体架构达到极限，可按以下边界拆分：

```
┌────────────────┐   ┌────────────────┐   ┌────────────────┐
│  API Gateway   │   │  Sync Service  │   │ Media Service  │
│  (路由+认证)    │   │  (长轮询+通知)  │   │ (上传+下载)    │
└───────┬────────┘   └───────┬────────┘   └───────┬────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   共享数据库     │
                    │   + Redis       │
                    └─────────────────┘
```

**优先拆分的模块：**
1. **Media** — 最独立，仅依赖 S3 和数据库
2. **Sync** — 最消耗连接资源，长轮询占用连接
3. **E2EE** — 密钥操作密集，可独立扩展

---

## 3. 功能扩展指南

### 3.1 添加新模块

```typescript
// 1. 创建模块文件
// app/modules/newfeature/routes.ts
import { Hono } from 'hono'
import type { AuthEnv } from '@/shared/middleware/auth'

const app = new Hono<AuthEnv>()

app.get('/endpoint', async (c) => {
  const { userId } = c.get('auth')
  // 业务逻辑
  return c.json({ result: 'ok' })
})

export { app as newFeatureRoutes }

// 2. 在 app/index.ts 注册路由
import { newFeatureRoutes } from '@/modules/newfeature/routes'
matrixApi.route('/newfeature', newFeatureRoutes)
```

### 3.2 添加新数据表

```typescript
// 1. 在 app/db/schema.ts 添加表定义
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const newTable = sqliteTable('new_table', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id),
  data: text('data', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date()),
})

// 2. 生成迁移
// bun run db:generate

// 3. 执行迁移
// bun run db:migrate
```

### 3.3 添加新的定时任务

```typescript
// 在 app/cron.ts 中添加
import { Cron } from 'croner'

export function startCron() {
  const jobs: Cron[] = []

  // 每 10 分钟执行
  jobs.push(new Cron('*/10 * * * *', async () => {
    // 任务逻辑
    logger.debug('Custom job completed')
  }))

  return () => jobs.forEach(j => j.stop())
}
```

### 3.4 扩展认证方式

当前仅支持 `m.login.token`（通过 SSO），扩展其他方式：

```typescript
// app/modules/auth/routes.ts
// 在 POST /login 处理器中添加新的认证类型
if (body.type === 'm.login.password') {
  // 密码认证逻辑
} else if (body.type === 'm.login.token') {
  // 现有 token 认证逻辑
}
```

---

## 4. Matrix 协议扩展性

### 4.1 当前协议覆盖

| 功能区域 | 覆盖度 | 说明 |
|---------|--------|------|
| 登录/认证 | 70% | SSO + Token，缺少密码、appservice |
| 房间管理 | 85% | 创建/加入/邀请/踢出/封禁，缺少 knock |
| 消息 | 80% | 发送/编辑/撤回/分页，缺少线程 |
| 状态事件 | 90% | 完整支持 |
| 同步 | 75% | 基础增量同步，缺少 lazy loading、滑动窗口 |
| E2EE | 80% | 密钥/OTK/交叉签名/设备间消息，缺少 key backup |
| 媒体 | 70% | 上传/下载/异步上传，缺少缩略图生成 |
| 推送通知 | 60% | 规则引擎完整，缺少实际推送网关 |
| 在线状态 | 80% | 基础状态管理和过期 |

### 4.2 可扩展的 MSC（Matrix Spec Changes）

| MSC | 名称 | 难度 | 价值 |
|-----|------|------|------|
| MSC3575 | Sliding Sync | 高 | 大幅改善初始同步性能 |
| MSC2716 | 历史消息导入 | 中 | 数据迁移必需 |
| MSC3440 | 线程消息 | 中 | 现代 IM 必需功能 |
| MSC1767 | 富文本消息 | 低 | 改善消息格式 |
| MSC3861 | OIDC 认证（取代 MSC2965） | 中 | 标准认证协议 |
| MSC2697 | 密钥备份 | 中 | E2EE 设备恢复 |
| MSC3916 | 认证媒体访问 | 低 | 安全改进 |

---

## 5. 缓存策略扩展

### 5.1 当前缓存使用

缓存层（unstorage）已就绪但使用有限：

```
目前缓存的: 几乎无（仅基础设施就绪）
应该缓存的:
  - 房间当前状态 (热数据)
  - 用户权限级别 (高频查询)
  - 设备密钥 (E2EE 查询)
  - 推送规则 (每消息评估)
  - 配额统计 (每上传检查)
```

### 5.2 建议的缓存层次

```
请求级缓存          进程级缓存          外部缓存
(Hono Context)     (in-memory Map)    (unstorage/Redis)
    │                   │                  │
    ├─ 认证上下文        ├─ 推送规则         ├─ 用户资料
    ├─ 权限级别         ├─ 房间成员数       ├─ 房间状态
    └─ 当前请求状态      └─ 在线状态         └─ 配额计数
```

---

## 6. 可观测性扩展

### 6.1 当前状态

| 维度 | 实现 | 覆盖 |
|------|------|------|
| 日志 | Winston（结构化） | ⭐⭐⭐⭐ |
| 指标 | 自定义计数器（内存） | ⭐⭐ |
| 追踪 | X-Request-Id | ⭐⭐ |
| 健康检查 | /health, /health/ready | ⭐⭐⭐ |

### 6.2 建议增强

1. **Prometheus 指标导出**
   - 请求延迟直方图
   - 数据库查询计数/延迟
   - 同步长轮询等待时间
   - E2EE 密钥操作计数
   - 每房间消息速率

2. **OpenTelemetry 追踪**
   - 请求跨模块追踪
   - 数据库查询追踪
   - 外部调用追踪（S3、OIDC）

3. **告警规则**
   - 数据库锁等待时间 > 1s
   - 同步响应时间 > 5s
   - OTK 库存低于阈值
   - 媒体存储容量告警

---

## 7. 部署架构扩展

### 7.1 当前：单进程部署

```
┌─────────────────────────┐
│  Bun 进程               │
│  ├─ HTTP Server         │
│  ├─ SQLite (WAL)        │
│  ├─ Cron Jobs           │
│  └─ EventEmitter        │
└─────────────────────────┘
```

**适用：** < 1,000 并发用户

### 7.2 目标：多进程 + 反向代理

```
┌──────────┐
│  Nginx   │  ← SSL 终止、静态文件、负载均衡
│  /Caddy  │
└────┬─────┘
     │
┌────▼─────┐  ┌──────────┐
│ Bun #1   │  │ Bun #2   │  ← 无状态 HTTP 处理
└────┬─────┘  └────┬─────┘
     │             │
┌────▼─────────────▼─────┐
│       Redis            │  ← Pub/Sub + Cache + Rate Limit
└────────────┬───────────┘
             │
┌────────────▼───────────┐
│     PostgreSQL         │  ← 共享数据库
└────────────────────────┘
```

**适用：** 1,000 - 50,000 并发用户

### 7.3 容器化部署

```dockerfile
# 建议的 Dockerfile 结构
FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN cd admin && bun install && bun run build

FROM oven/bun:latest
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/admin/dist ./admin/dist
COPY --from=builder /app/drizzle ./drizzle
VOLUME /app/data
EXPOSE 3000
CMD ["bun", "dist/index.js"]
```

---

## 8. 总结与优先级

### 短期（1-2 个月）

1. 添加缺失的数据库索引
2. 修复 N+1 查询问题
3. 添加热数据缓存（房间状态、权限级别）
4. 创建 Dockerfile

### 中期（3-6 个月）

5. 状态外部化（Redis Pub/Sub 替代 EventEmitter）
6. 分布式限流（Redis 后端）
7. Prometheus 指标导出
8. 实现 Sliding Sync (MSC3575)

### 长期（6-12 个月）

9. PostgreSQL 迁移选项
10. 容器编排（Docker Compose / K8s）
11. 线程消息支持
12. 推送网关集成
