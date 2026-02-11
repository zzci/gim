# GIM 改进路线图

> 版本: 0.4.0 | 最后更新: 2026-02-11

## 1. 已发现问题清单

### 1.1 严重级别（需优先修复）

| # | 问题 | 位置 | 影响 | 状态 |
|---|------|------|------|------|
| S1 | ~~**进程内状态阻止水平扩展**~~ — SSO/OAuth 状态已迁移至 unstorage cache，限流器/上传窗口保持进程内（性能优先），Notifier 保持 EventEmitter（SQLite 单进程） | sync/notifier.ts, auth/routes.ts, oauth/provider.ts, rateLimit.ts, media/routes.ts | ~~无法多进程部署~~ | ✅ Phase 3 (部分：状态外部化) |
| S2 | ~~**缺失数据库索引**~~ | db/schema.ts | ~~大数据量时查询性能急剧下降~~ | ✅ Phase 1 |
| S3 | ~~**N+1 查询问题**~~ | helpers/eventQueries.ts, formatEvent.ts, notification/service.ts, presence/service.ts | ~~房间多/成员多时同步延迟飙升~~ | ✅ Phase 2 |
| S4 | ~~**设备删除/账号停用非事务性**~~ | device/routes.ts, account/routes.ts | ~~异常时产生孤儿数据~~ | ✅ Phase 1 |

### 1.2 高级别问题

| # | 问题 | 位置 | 影响 | 状态 |
|---|------|------|------|------|
| H1 | ~~**auth middleware 每请求写入 devices**~~ | shared/middleware/auth.ts | ~~写入放大，SQLite 写入锁压力~~ | ✅ Phase 1 (5min 节流) |
| H2 | ~~**事件查询双表合并在内存执行**~~ | helpers/eventQueries.ts | ~~大房间内存消耗高~~ | ✅ Phase 2 (UNION ALL) |
| H3 | ~~**媒体配额 TOCTOU 竞态**~~ | media/routes.ts | ~~存储超限~~ | ✅ Phase 2 (事务原子化) |
| H4 | ~~**SSO 回调状态 10 分钟 TTL**~~ — SSO 状态迁移至 unstorage cache (TTL 自动过期)，auth 清理间隔降至 1 分钟 | auth/routes.ts, oauth/provider.ts | ~~内存泄漏~~ | ✅ Phase 3 |
| H5 | ~~**缺失外键约束**~~ | db/schema.ts | ~~数据孤儿风险~~ | ✅ Phase 1 |
| H6 | ~~**Cron 任务无错误处理**~~ | cron.ts | ~~静默失败，孤儿数据堆积~~ | ✅ Phase 1 |

### 1.3 中级别问题

| # | 问题 | 位置 | 影响 | 状态 |
|---|------|------|------|------|
| M1 | ~~交叉签名密钥上传不验证签名内容~~ | e2ee/routes.ts | ~~可注入虚假签名~~ | ✅ Phase 3 (结构+签名验证) |
| M2 | ~~notifyUser() 在循环中逐个调用~~ | e2ee/routes.ts, message/service.ts | ~~通知风暴~~ | ✅ Phase 1 (Set 去重) |
| M3 | ~~管理面板 Token 存 localStorage~~ | admin/src/api.ts, admin/middleware.ts | ~~XSS 可窃取管理权限~~ | ✅ Phase 3 (httpOnly cookie) |
| M4 | ~~媒体文件名清理不完整~~ | media/routes.ts | ~~null 字节/路径遍历风险~~ | ✅ Phase 1 |
| M5 | ~~测试覆盖不足 — 无 E2EE 验证流程测试、无媒体测试、无管理 API 测试~~ | tests/ | ~~回归风险~~ | ✅ Phase 4 |
| M6 | ~~presence 变更不通知共享房间成员~~ | presence/service.ts | ~~在线状态延迟感知~~ | ✅ Phase 3 |
| M7 | ~~createRoomBody 使用 passthrough()~~ | shared/validation.ts | ~~允许任意额外字段~~ | ✅ Phase 1 |

### 1.4 低级别问题

| # | 问题 | 位置 | 影响 | 状态 |
|---|------|------|------|------|
| L1 | ~~metrics 指标仅内存存储~~ | shared/metrics.ts | ~~重启丢失~~ | ✅ Phase 3 (Prometheus text format) |
| L2 | ~~管理面板缺少操作确认弹窗~~ | admin/src/routes/ | ~~误操作风险~~ | ✅ Phase 3 (ConfirmDialog) |
| L3 | ~~管理面板无活动审计日志~~ | admin/, admin/routes.ts, db/schema.ts | ~~无法追溯管理操作~~ | ✅ Phase 3 (adminAuditLog table + UI) |
| L4 | ~~管理面板搜索使用 LIKE %keyword%~~ | admin/routes.ts | ~~无法利用索引~~ | ✅ Phase 3 (prefix match for @/!) |

---

## 2. 改进路线图

### Phase 1: 稳定性加固 ✅ 已完成

**目标：** 修复关键缺陷，提升数据一致性和查询性能

#### 1.1 数据库索引补全 [S2] ✅

已添加全部 8 个索引：oauthTokens (type+accountId, grantId, deviceId), e2eeToDeviceMessages (userId+deviceId), e2eeOneTimeKeys (userId+deviceId+claimed), roomMembers (userId+membership), media (userId), mediaDeletions (completedAt), pushNotifications (userId)

#### 1.2 事务性保障 [S4] ✅

已对设备删除、账号停用、登出所有设备三个操作包裹 `db.transaction()`

#### 1.3 Cron 错误处理 [H6] ✅

所有 4 个 cron 任务已添加 try-catch + `logger.error()` 日志

#### 1.4 减少设备写入放大 [H1] ✅

auth middleware 添加 5 分钟节流，仅在超过阈值时才更新 lastSeenAt/ipAddress

#### 1.5 添加缺失外键 [H5] ✅

已添加 accountTokens.userId → accounts.id 和 media.userId → accounts.id 外键

#### 1.6 其他修复 ✅

- [M2] notifyUser() 使用 Set 去重，消除重复通知
- [M4] 媒体文件名清理增强：null 字节移除、路径分隔符替换、255 字符限制
- [M7] createRoomBody 移除 `.passthrough()`

---

### Phase 2: 性能优化 ✅ 已完成

**目标：** 消除 N+1 查询，提升同步性能

#### 2.1 事件查询优化 [H2, S3] ✅

- `queryRoomEvents` 改用 SQL `UNION ALL + ORDER BY + LIMIT`，从 2 次查询 + 内存合并优化为 1 次 SQL 查询
- `formatEventWithRelations` 改为批量版本，使用 `json_extract` 直接在 SQL 中过滤 m.replace 关系，从 N+1 优化为 1 次查询

#### 2.2 同步查询批量化 [S3] ✅

- 成员计数：单条 `GROUP BY` SQL 替代逐房间 `.all().length`
- Heroes：单条批量查询替代逐房间查询
- 已读回执：单条 `IN` 查询替代逐房间查询
- 未读计数：单条 `GROUP BY + LEFT JOIN` 替代逐房间查询 + `.all().length`
- OTK 计数：使用 SQL `COUNT()` 替代 `.all().length`
- Presence 室友查询：`JOIN` 替代 N+1 逐房间遍历

#### 2.3 缓存热数据 ✅

已实现 `TtlCache` 同步缓存，应用于推送规则评估热路径：
- 权限级别内容：TTL 1min，权限变更时主动失效
- 房间成员计数：TTL 1min，成员变更时主动失效
- 用户显示名：TTL 5min

#### 2.4 媒体配额原子化 [H3] ✅

使用事务将配额检查 + media 记录插入合为原子操作，上传失败时回滚记录

---

### Phase 3: 可扩展性与安全 ✅ 已完成

**目标：** 状态外部化、Prometheus 指标、安全修复、管理面板增强

#### 3.1 状态外部化 [S1, H4] ✅

- SSO 流程状态 (`ssoStates`) 迁移至 unstorage cache (`sso:{stateId}`, TTL 10min)
- OAuth 上游状态 (`upstreamAuthStates`) 迁移至 unstorage cache (`oauth:upstream:{stateId}`)
- OAuth 动作状态 (`actionStates`) 迁移至 unstorage cache (`oauth:action:{stateId}`)
- SSO 清理间隔从 5min 降至 1min
- 限流器和上传速率窗口保持进程内（性能优先，添加设计说明注释）

#### 3.2 Prometheus 指标 [L1] ✅

- `gim_http_requests_total{method,status}` — 请求计数器
- `gim_http_request_duration_seconds{method,path}` — 请求延迟直方图 (11 个桶)
- `gim_active_sync_connections` — 活跃长轮询连接数 gauge
- `gim_uptime_seconds` — 服务器运行时间
- `GET /metrics` 返回 Prometheus text format (text/plain; version=0.0.4)
- 路径标签自动归一化防止高基数 (room ID → :roomId, etc.)

#### 3.3 安全修复 [M1, M3, M6] ✅

- [M1] 交叉签名密钥上传添加结构验证：keys 对象、signatures 非空、usage 匹配、ed25519 密钥唯一、user_id 匹配
- [M3] 管理面板 Token 从 localStorage 迁移至 httpOnly cookie (SameSite=Strict, Path=/admin)
  - 新增 `POST /admin/api/login` (设置 cookie) 和 `POST /admin/api/logout` (清除 cookie)
  - 前端移除所有 localStorage 用法，改用 `credentials: 'same-origin'`
- [M6] Presence 变更通知共享房间成员：`setPresence()` 和 `touchPresence()` 在状态变化时调用 `notifyRoommates()`

#### 3.4 管理面板增强 [L2, L3, L4] ✅

- [L2] 新增 `ConfirmDialog` 组件，应用于用户停用、媒体删除、Token 撤销
- [L3] 新增 `adminAuditLog` 表 + `logAdminAction()` + `GET /admin/api/audit-log` + 前端审计日志页面
- [L4] 用户搜索 `@` 开头使用前缀匹配 (`LIKE '@..%'`)，房间搜索 `!` 开头使用前缀匹配

#### 3.5 待完成

```
- ✅ 容器化（Dockerfile + docker-compose.yml）→ Phase 4 完成
- Notifier → Redis Pub/Sub（需要多进程部署时实现）
- 限流器 → Redis（需要多进程部署时实现）
- 结构化日志增强 (trace_id)
```

---

### Phase 4: 功能完善 ✅ 已完成

**目标：** 补全 Matrix 协议覆盖，增强管理能力，Docker 支持

#### 4.1 容器化 ✅

- 多阶段 Dockerfile (oven/bun:latest) — 构建服务器 + 管理面板
- docker-compose.yml — 端口映射、数据卷、健康检查
- .dockerignore — 排除开发文件

#### 4.2 协议功能补全

| 功能 | MSC | 优先级 | 状态 |
|------|-----|--------|------|
| Sliding Sync | MSC3575 | 高 | ✅ 已实现 — 房间列表排序、窗口范围、增量同步、扩展 (to_device, e2ee, account_data) |
| 线程消息 | MSC3440 | 高 | ✅ 已实现 — 线程回复、线程根查询、线程摘要 (unsigned.m.relations.m.thread) |
| 推送网关 | — | 中 | ✅ 已实现 — pushers 表、GET/POST pushers、HTTP 推送网关 |
| 密钥备份 | MSC2697 | 中 | ⏭️ 跳过 (SSO only) |
| 缩略图生成 | — | 中 | ⏭️ 跳过 (E2EE — 服务端无法解密媒体) |
| URL 预览 | — | 低 | ⏭️ 跳过 (E2EE — 服务端无法读取消息内容) |
| 密码登录 | — | 低 | ⏭️ 跳过 (SSO only) |
| Application Service | — | 中 | ✅ Phase 4.5 — AS 注册、事件推送、命名空间、Ping |
| VoIP TURN | — | 中 | ✅ Phase 4.5 — TURN 凭证、LiveKit RTC |

#### 4.3 管理面板增强 ✅

- 房间状态查看/编辑 — GET/PUT /api/rooms/:roomId/state 端点 + 前端状态查看器/编辑器
- 设备管理 — DELETE /api/devices/:userId/:deviceId (清理所有关联数据) + 前端删除按钮
- 数据可视化 — GET /api/stats/history (30 天趋势) + SVG 折线图 (用户/房间/媒体/消息)

#### 4.4 测试覆盖提升 [M5] ✅

新增 8 个测试文件:
- `tests/media.test.ts` — 媒体上传/下载/配置/异步上传/文件名
- `tests/admin.test.ts` — 统计/用户/房间/媒体/Token/审计日志/权限
- `tests/presence.test.ts` — 在线状态设置/获取/权限/同步
- `tests/e2ee-ordering.test.ts` — To-device 消息排序/清理/设备列表变更
- `tests/sync-edge.test.ts` — 短超时/长轮询唤醒/初始同步
- `tests/concurrent.test.ts` — 并行消息/房间创建/同步并发
- `tests/threads.test.ts` — 线程回复/根查询/摘要/分页
- `tests/sliding-sync.test.ts` — 房间列表/排序/过滤/增量同步/扩展

#### 4.5 遗留安全修复

```
✅ 已在 Phase 3 完成:
- [M1] 交叉签名密钥上传签名验证
- [M3] 管理面板 Token 改用 httpOnly Cookie
- [M6] presence 变更通知共享房间成员
```

---

### Phase 4.5: 协议扩展与运维增强 ✅ 已完成

**目标：** 扩展协议覆盖，改善开发与部署体验

#### 4.5.1 Application Service 支持 ✅

- YAML 注册文件导入 (`data/appservices/*.yaml`)
- `appservices` 数据表（DB 持久化 + 内存编译缓存）
- 命名空间匹配（users/aliases/rooms 正则）
- 事件推送事务（`PUT /_matrix/app/v1/transactions/:txnId`）
- 指数退避重试（最大 5 分钟）
- Ping 端点 (`POST /_matrix/client/v1/appservice/:id/ping`)
- Cron 每 5 秒处理事务队列
- 自动创建 AS 发送者用户
- `IM_AS_REGISTRATION_DIR` 配置项

#### 4.5.2 VoIP / MatrixRTC 支持 ✅

- TURN 凭证端点 (`GET /_matrix/client/v3/voip/turnServer`)
  - HMAC-SHA1 临时凭证生成（共享密钥认证）
  - 可配置 TTL、URI 列表
- MatrixRTC 传输端点 (`GET /_matrix/client/v1/rtc/transports`, MSC4143)
  - LiveKit SFU 集成
- 环境变量: `IM_TURN_URIS`, `IM_TURN_SHARED_SECRET`, `IM_TURN_TTL`, `IM_LIVEKIT_SERVICE_URL`

#### 4.5.3 E2EE 稳定性修复 ✅

- 交叉签名密钥上传不再删除已有密钥 (`e638d2a`)
- 交叉签名表重命名 `e2eeCrossSigningKeys` → `accountCrossSigningKeys` (`3d38484`)
- 设备签名合并而非替换 (`f959fa7`, `1a72b7a`)
- 交叉签名和签名变更通知客户端 (`867bc33`)
- `room_keys/version` 存根返回 M_NOT_FOUND（SDK 优雅处理）

#### 4.5.4 开发与运维增强 ✅

- 启动时自动执行数据库迁移 (`d87fddd`)
- Docker 构建时自动生成 `build.json`（git commit/branch/时间） (`1e3d553`)
- 根路由自动从注册的 Hono 路由生成 API 列表 (`d596794`)
- 直接运行 TypeScript 源码替代构建打包 (`24d7632`)
- `IM_LOG_LEVEL` 可配置日志级别 (`d3de5f4`)
- 增量同步返回 account_data 变更 (`16771a8`)
- 账号过滤器上传去重 (`91fe81b`)
- 空 stateKey 的 PUT state 修复 (`1f46d3a`)

---

### Phase 5: 生产就绪（长期，6-12 个月）

**目标：** 生产级部署能力

#### 5.1 数据库升级路径

```
准备 PostgreSQL 迁移:
  - 编写 PG 兼容 schema（类型映射）
  - 迁移 raw SQL (eventQueries UNION ALL, sync batch queries,
    presence JOIN, formatEvent json_extract)
  - 连接池配置
  - 数据迁移脚本
```

#### 5.2 运维工具

```
- 数据库备份/恢复工具
- 用户数据导出/导入
- 服务器间数据迁移
- 性能诊断工具
```

#### 5.3 安全加固

```
- 添加 CSP/安全头
- 速率限制精细化（按端点）
- 自动过期不活跃设备
```

---

## 3. 技术债务总结

### 代码质量

| 类别 | 原始数量 | 已修复 | 剩余 | 说明 |
|------|----------|--------|------|------|
| N+1 查询 | 6 处 | 6 | 0 | ✅ Phase 2 全部消除 |
| 缺失事务 | 3 处 | 3 | 0 | ✅ Phase 1 全部修复 |
| 内存状态 | 5 处 | 3 | 2 | ✅ SSO/OAuth → cache + AS 注册编译缓存 / 限流器+Notifier 保持进程内 |
| 缺失索引 | 12 个 | 12 | 0 | ✅ Phase 1 全部补全 |
| 缺失外键 | 3 个 | 2 | 1 | oauthTokens.accountId 格式差异待处理 |
| 缺失错误处理 | 3 处 | 1 | 2 | cron ✅ / 缓存层、S3 操作待处理 |
| 安全问题 | 3 个 | 3 | 0 | ✅ M4 Phase 1 / M1, M3 Phase 3 |

### 测试债务

| 类别 | 有测试 | 无测试 |
|------|--------|--------|
| 房间管理 | ✅ | |
| 消息 | ✅ | |
| 同步 | ✅ | |
| 同步边缘场景 | ✅ Phase 4 | |
| E2EE 基础 | ✅ | 验证流程、密钥轮换 |
| E2EE 排序 | ✅ Phase 4 | |
| 媒体 | ✅ Phase 4 | |
| 管理 API | ✅ Phase 4 | |
| 在线状态 | ✅ Phase 4 | |
| 线程消息 | ✅ Phase 4 | |
| Sliding Sync | ✅ Phase 4 | |
| 并发竞态 | ✅ Phase 4 | |

---

## 4. 关键里程碑

```
v0.1.1  ─── ✅ 索引补全 + 事务修复 + Cron 错误处理 + 外键 + 写入节流
v0.1.2  ─── ✅ N+1 查询消除 + UNION ALL + 批量同步 + 缓存层 + 配额原子化
v0.2.0  ─── ✅ 状态外部化 + Prometheus + 安全修复 (M1, M3, M6) + 管理面板增强 (L2-L4)
v0.3.0  ─── ✅ Sliding Sync + 线程消息 + Docker 支持 + 推送网关 + 管理面板增强 + 测试覆盖
v0.4.0  ─── ✅ Application Service + VoIP/TURN/LiveKit + E2EE 修复 + 自动迁移 + 运维增强
v1.0.0  ─── 生产就绪（PG 可选、完整测试、运维工具）
```
