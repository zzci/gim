# GIM — 任务清单

> 更新日期: 2026-02-21

## 使用规范

### 任务格式

- [ ] **简短祈使句标题**
  - description: 需要做什么，包含上下文和验收标准
  - activeForm: 进行中时的现在进行时描述（用于 spinner 显示）
  - createdAt: YYYY-MM-DD HH:mm
  - blocked by: 依赖的前置任务（可选）
  - blocks: 被本任务阻塞的后续任务（可选）
  - owner: 负责人/agent 名称（可选）

### 状态标记

| 标记 | 含义 |
|------|------|
| `[ ]` | 待办 |
| `[-]` | 进行中 |
| `[x]` | 已完成 |
| `[~]` | 关闭/不做 |

---

## 任务

- [~] `GIM-001` **实现 Federation（Server-Server）协议** `P1`
  - description: 实现 Matrix S2S API，支持跨服务器房间加入、事件联合、签名验证。涉及新模块 `app/modules/federation/`，需实现 key fetching、event signing、transaction 推送。验收：两个 gim 实例可跨域加入房间并收发消息。
  - activeForm: Implementing Federation protocol
  - createdAt: 2026-02-20 00:00
  - closedReason: 暂时不实现

- [~] `GIM-002` **实现多进程同步通知总线（Notifier → Redis Pub/Sub）** `P1`
  - description: 将 `app/modules/sync/notifier.ts` 从 EventEmitter 迁移到 Redis Pub/Sub，支持多进程部署下 sync 通知。保留内存 driver 作为 fallback。验收：多实例部署时 sync long-poll 能跨进程收到通知。
  - activeForm: Implementing Redis Pub/Sub notification bus
  - createdAt: 2026-02-20 00:00
  - blocks: GIM-003
  - closedReason: 暂时不实现

- [~] `GIM-003` **实现多进程限流统一状态（RateLimit → Redis）** `P2`
  - description: 将 `app/shared/middleware/rateLimit.ts` 的计数器从内存迁移到 Redis，支持多进程共享限流状态。验收：多实例部署时限流计数一致。
  - activeForm: Implementing Redis rate limit state
  - createdAt: 2026-02-20 00:00
  - blocked by: GIM-002
  - closedReason: 暂时不实现

- [~] `GIM-004` **PostgreSQL 迁移路径** `P2`
  - description: 设计并实现从 SQLite 到 PostgreSQL 的迁移方案。包括：schema 兼容层（Drizzle multi-dialect）、SQL 语法差异处理、数据迁移工具。验收：同一代码可切换 SQLite/PG，数据可无损迁移。
  - activeForm: Implementing PostgreSQL migration path
  - createdAt: 2026-02-20 00:00
  - closedReason: 暂时不实现

- [~] `GIM-005` **实现运维工具（备份/恢复、导入导出、诊断）** `P2`
  - description: 在 `tools/` 下新增运维脚本：DB 备份/恢复（SQLite snapshot）、用户数据导入导出（JSON 格式）、服务器诊断（连接数、缓存命中率、DB 大小）。验收：可通过 CLI 完成常见运维操作。
  - activeForm: Implementing ops tools
  - createdAt: 2026-02-20 00:00
  - closedReason: 暂时不实现

- [~] `GIM-006` **安全加固（CSP/安全头、端点级限流、设备自动过期）** `P2`
  - description: 添加 CSP/安全响应头中间件、为敏感端点（login、register、keys/upload）配置独立限流策略、实现不活跃设备自动过期清理（cron job）。验收：安全头通过 securityheaders.com A 级、限流可按端点独立配置。
  - activeForm: Implementing security hardening
  - createdAt: 2026-02-20 00:00
  - closedReason: 拆分为 GIM-018 ~ GIM-020

- [~] `GIM-007` **E2EE 深度场景补强（验证流程、密钥轮换）** `P2`
  - description: 补全 E2EE 边缘场景：完整 SAS 验证流程测试、Megolm session 密钥轮换触发逻辑、跨设备验证状态同步。新增对应集成测试。验收：Element Web/Android 完成完整验证流程无报错。
  - activeForm: Strengthening E2EE edge cases
  - createdAt: 2026-02-20 00:00
  - closedReason: 拆分为 GIM-021 ~ GIM-024

- [x] `GIM-008` **修复 device_lists.changed 幽灵变更导致频繁 keys/query** `319133a`
- [x] `GIM-009` **Cross-signing trust 失效修复，缓存 joined members，并行批量删除** `c96b9f3`
- [x] `GIM-010` **统一缓存层 unstorage，抽取 auth model，修复审计 bug** `ff2796d`
- [x] `GIM-011` **抽取 model 层（room state、membership、device、account）** `fd5f4b2`
- [x] `GIM-012` **缓存 auth trust state、account status、room state、membership** `7d82b13`
- [x] `GIM-013` **Token 缓存与重建工具** `4e7ec7d`
- [x] `GIM-014` **E2EE fallback key tracking、sync 优化** `08cbdaa`
- [x] `GIM-015` **安全加固、性能索引、内存泄漏修复** `7774e42`
- [x] `GIM-016` **Auto-trust first device、trust recovery paths** `6810f31`
- [~] `GIM-017` **服务端 Room Key Backup（`/room_keys/version*`）** — 架构策略为关闭，接口保持 `M_NOT_FOUND`

- [x] `GIM-018` **添加安全响应头中间件** `P1`
  - description: 新建 `app/shared/middleware/securityHeaders.ts`，设置 CSP（`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'`）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`、HSTS（生产环境默认 1 年，通过 `IM_HSTS_MAX_AGE` 配置，dev 默认 0）。插入 `app/index.ts` 中间件栈 CORS 之后、requestLog 之前。验收：`curl -I` 可见所有安全头。
  - activeForm: Adding security response headers middleware
  - createdAt: 2026-02-21 00:00

- [x] `GIM-019` **敏感端点独立限流** `P1`
  - description: 重构 `app/shared/middleware/rateLimit.ts`，抽取 `createRateLimitMiddleware({ windowMs, maxRequests, keyPrefix })` 工厂函数。未认证端点按 IP（`x-forwarded-for`）限流。在 `app/index.ts` 对敏感端点应用独立限流：login 10/min、register 5/min、oauth/auth+token 20/min、keys/upload 60/min、keys/claim 120/min。全局默认 600/min 不变。新增 `IM_RATE_LIMIT_LOGIN_MAX`、`IM_RATE_LIMIT_REGISTER_MAX` 配置项。验收：快速请求 login 超过 10 次后返回 429 + `Retry-After` 头。
  - activeForm: Implementing per-endpoint rate limiting
  - createdAt: 2026-02-21 00:00

- [x] `GIM-020` **不活跃设备自动过期清理** `P1`
  - description: 在 `app/cron.ts` 新增 `cleanupInactiveDevices()`，每日 3:00 执行。查找 `COALESCE(lastSeenAt, createdAt)` 超过 `IM_DEVICE_INACTIVE_DAYS`（默认 90 天）的设备，排除仍持有有效 OAuth/account token 的设备。级联删除：device keys、OTKs、fallback keys、to-device messages、device 行，并插入 `e2eeDeviceListChanges` + `notifyUser()`。批量 100 条。验收：插入 90+ 天前的测试设备（无 token），运行清理后设备及关联数据被删除。
  - activeForm: Implementing device auto-expiry cron
  - createdAt: 2026-02-21 00:00

- [x] `GIM-021` **设备封锁端点与执行** `P1`
  - description: 扩展 `PUT /devices/:deviceId`（`app/modules/device/putDeviceRoute.ts`）接受 `trust_state: 'blocked' | 'unverified'`，仅 trusted 设备可封锁同用户其他设备，不可封锁自身。封锁后清除信任缓存 + 发出 deviceListChange。修改 `app/shared/middleware/auth.ts`：trust 解析后若 `blocked` 立即返回 `M_FORBIDDEN`（封锁设备不可访问任何端点）。修改 `sendToDeviceRoute.ts`：跳过 blocked 设备投递（含验证事件）。支持解封（设回 `unverified`）。验收：封锁设备后所有请求返回 403，解封后恢复 unverified 状态。
  - activeForm: Implementing device blocking endpoint
  - createdAt: 2026-02-21 00:00

- [x] `GIM-022` **跨用户 user-signing key 签名** `P2`
  - description: 修改 `app/modules/e2ee/signaturesUploadRoute.ts`，当目标 `userId !== auth.userId` 时，允许用 auth 用户的 user-signing key 签署目标用户的 master key。校验目标 master key 存在、auth 用户有 user-signing key，将签名合并到 `accountDataCrossSigning` 的 master key `signatures` 字段。`keysQueryRoute.ts` 无需改动（签名已随 master key 数据返回）。验收：Alice 签署 Bob master key 后，Charlie 查询 Bob keys 可见 Alice 签名。
  - activeForm: Implementing cross-user trust signatures
  - createdAt: 2026-02-21 00:00

- [x] `GIM-023` **验证会话超时** `P3`
  - description: 新建 `app/modules/e2ee/verificationSessions.ts`，内存 Map 跟踪验证会话（transactionId → startedAt），10 分钟超时（Matrix 规范），每 60 秒清理过期条目。修改 `sendToDeviceRoute.ts`：`m.key.verification.request` 开始跟踪；后续验证事件检查超时，过期则丢弃；`done`/`cancel` 清除会话。验收：超时后的验证消息被丢弃，正常流程不受影响。
  - activeForm: Implementing verification session timeout
  - createdAt: 2026-02-21 00:00

- [x] `GIM-024` **E2EE 边缘场景集成测试** `P2`
  - description: 新建 `tests/e2ee-edge-cases.test.ts`，覆盖：1) cross-signing reset 后多设备信任状态传播；2) 多设备验证级联（A 验证 B，B 验证 C）；3) 封锁设备阻止 to-device 投递（依赖 GIM-021）；4) 跨用户签名在 /keys/query 可见（依赖 GIM-022）；5) key upload 幂等性（重复上传相同 keys 无副作用）；6) m.room_key_request → m.forwarded_room_key 传输往返。验收：`bun test tests/e2ee-edge-cases.test.ts` 全部通过。
  - activeForm: Writing E2EE edge case integration tests
  - createdAt: 2026-02-21 00:00
  - blocked by: GIM-021, GIM-022
