# GIM — 任务清单

> 更新日期: 2026-02-22

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

- [x] `GIM-025` **修复 Invite 消息未实时推送到 sync** `P1`
  - description: 当用户被邀请加入房间时，invite 事件没有实时传递给被邀请方的 sync long-poll，需要等到当前 sync 超时后下一次轮询才能收到。根因可能是 `notifyUser()` 在处理 invite 事件时未被调用，或 invite 写入后未正确触发 sync notifier。需要排查 `app/modules/room/` 中 invite 相关路由（如 `inviteRoute.ts`）在写入 invite 事件后是否调用了 `notifyUser(targetUserId)`，以及 `app/modules/sync/notifier.ts` 是否正确唤醒被邀请用户的 long-poll。验收：邀请用户后，被邀请方的 sync long-poll 立即返回包含 invite 的响应，无需等待超时。
  - activeForm: Fixing real-time invite delivery in sync
  - createdAt: 2026-02-21 16:00

- [x] `GIM-026` **实现 Direct Room（DM）invite 事件携带 is_direct** `P1`
  - description: 在 createRoom 和独立 invite 端点中，当房间为 direct 时，invite 的 m.room.member 事件 content 中添加 is_direct: true。遵循 Matrix 规范，客户端通过此字段自行维护 m.direct account data。修改 service.ts、membershipRoutes.ts、validation.ts。验收：创建 is_direct 房间后 invite 事件包含 is_direct: true，Bob 通过 sync 可见此字段。
  - activeForm: Implementing is_direct propagation in invite events
  - createdAt: 2026-02-21 16:00

- [x] `GIM-027` **提高限流默认限额 + 修复反向代理 IP 检测** `P0`
  - description: 1) 提高限流默认值：login 10→30/min、register 5→15/min、oauth 20→100/min；2) oauth 限额新增 `IM_RATE_LIMIT_OAUTH_MAX` 环境变量支持；3) `getClientIp()` 改为优先 `x-forwarded-for` → `x-real-ip` → Bun `getConnInfo()` socket IP 的 fallback 链，修复反向代理后所有请求共享 `unknown` 限流桶的问题。
  - activeForm: 提高限流限额并修复反向代理 IP 检测
  - createdAt: 2026-02-22 00:00

- [x] `GIM-028` **修复登录/注册限流路由匹配错误** `P1`
  - description: `app/index.ts:112` 使用 `app.use('/_matrix/client/v3/login/*', loginRateLimit)` 通配符仅匹配子路径，不匹配 `POST /login` 本身，导致主登录端点实际未被独立限流（仅受全局 600/min），而 SSO 路径 `/login/sso/*` 被误限。register 同理。修复方案：将路由匹配改为精确路径挂载，或同时挂载根路径和子路径。验收：`POST /_matrix/client/v3/login` 触发独立限流，SSO 路径使用 oauth 限流而非 login 限流。
  - activeForm: 修复登录注册限流路由匹配
  - createdAt: 2026-02-22 00:00

---

## Code Review 发现（2026-02-23）

> 由 5 个并行审查 agent 完成全项目审查：架构、安全、sync/E2EE、rooms/OAuth/media、基础设施/测试

### CRITICAL

- [x] `GIM-029` **修复 OAuth redirect_uri 开放重定向** `P0`
  - description: `oauth/provider.ts:253` — redirect_uri 验证仅拦截危险 scheme（javascript/data），但接受任意 `https://` URL。结合 `/oauth/register` 开放注册（GIM-030），攻击者可将授权码导向受控 URL 窃取。修复：在 `/auth` 端点校验 redirect_uri 是否匹配客户端注册时提交的 URI 列表。验收：使用未注册的 redirect_uri 发起 auth 请求返回 400。
  - activeForm: 修复 OAuth redirect_uri 验证
  - createdAt: 2026-02-23 15:00

- [x] `GIM-030` **限制 OAuth 动态客户端注册** `P0`
  - description: `oauth/provider.ts:573` — `POST /oauth/register` 完全无认证，任何人可注册客户端并获取 client_id。与 GIM-029 组合可实现授权码窃取。修复：要求 initial_access_token，或在 auth 端点强制校验 redirect_uri 白名单。验收：未认证的 register 请求被拒绝或 redirect_uri 绑定生效。
  - activeForm: 限制 OAuth 客户端注册
  - createdAt: 2026-02-23 15:00

- [x] `GIM-031` **修复 cross-signing reset 伪认证** `P0`
  - description: `e2ee/crossSigningHelpers.ts:22-44` — re-auth 检查仅比较 Bearer token 与 auth.session 是否相同，即用自己的 access token 即可通过。任何窃取了 session token 的攻击者可立即 reset cross-signing keys。修复：实现真正的 UIA（交互式认证）流程，或要求短生命周期的 challenge token。验收：使用 access token 作为 session 发起 reset 请求被拒绝。
  - activeForm: 修复 cross-signing reset 认证
  - createdAt: 2026-02-23 15:00

- [x] `GIM-032` **修复 X-Forwarded-For IP 欺骗绕过限流** `P0`
  - description: `rateLimit.ts:63` — 无条件信任 `X-Forwarded-For` 头，攻击者可伪造 IP 完全绕过 IP 限流（login/register/oauth）。修复：新增 `IM_TRUSTED_PROXY_CIDRS` 配置，仅从受信代理接受 XFF 头，否则使用 socket IP。验收：直连发送伪造 XFF 头后限流仍生效。
  - activeForm: 修复 IP 欺骗绕过限流
  - createdAt: 2026-02-23 15:00

- [x] `GIM-033` **修复 IN (?) 子句超过 SQLite 999 参数限制** `P0`
  - description: `sync/roomData.ts:87` 等 8+ 处 — 动态构建 `IN (${roomIds.map(() => '?').join(',')})` 子句，用户加入 1000+ 房间时超出 SQLite SQLITE_LIMIT_VARIABLE_NUMBER 限制导致崩溃。修复：实现 chunkArray 工具函数，将大数组分批 ≤999 执行后合并结果。验收：模拟 1500 个房间 ID 的 sync 请求不崩溃。
  - activeForm: 修复 SQL IN 子句参数限制
  - createdAt: 2026-02-23 15:00

- [ ] `GIM-034` **轮换泄露的密钥并清理 git 历史** `P0`
  - description: `.env` 含真实 OIDC client ID（`bldldkkwmd526e0ila59x`）和弱 cookie secret（`sssssss`）。`examples/.tokens.json` 含真实 access/refresh token 并已提交到 git。修复：1）在 login.gid.io 轮换 OIDC client ID；2）生成 32+ 字符 cookie secret；3）`git filter-repo` 清除 .tokens.json 历史；4）加强 config.ts 中 cookie secret 最小长度校验。验收：旧凭证失效，新密钥符合安全长度要求。
  - activeForm: 轮换密钥并清理 git 历史
  - createdAt: 2026-02-23 15:00

- [x] `GIM-035` **为 /metrics 端点添加认证** `P0`
  - description: `index.ts:90` — Prometheus `/metrics` 端点完全公开，泄露服务器内部信息（连接数、请求率）。修复：新增 `IM_METRICS_SECRET` 环境变量，配置后要求 `Authorization: Bearer <secret>` 头；或在 Traefik 层拦截。验收：未认证访问 /metrics 返回 401。
  - activeForm: 为 metrics 端点添加认证
  - createdAt: 2026-02-23 15:00

- [x] `GIM-036` **为 admin login 添加限流** `P0`
  - description: `admin/authRoutes.ts:12` — admin 登录端点 `POST /admin/api/login` 在 `adminMiddleware` 之前挂载，无任何限流保护。修复：对 admin login 路由应用 IP 限流（如 10/min）。验收：快速请求 admin login 超过限额后返回 429。
  - activeForm: 为 admin login 添加限流
  - createdAt: 2026-02-23 15:00

### HIGH — 安全

- [x] `GIM-037` **升级 hono 修复 JWT 算法混淆 CVE** `P0`
  - description: 当前 hono 4.7.10 存在多个 HIGH CVE（GHSA-3vhc、GHSA-f67f — JWT 算法混淆导致令牌伪造，GHSA-m732 — 授权绕过）。修复：`bun update hono`（需 ≥4.10.3）。验收：`bun audit` 无 hono 相关 HIGH 告警。
  - activeForm: 升级 hono 修复 CVE
  - createdAt: 2026-02-23 15:00

- [x] `GIM-038` **修复 media Content-Type 存储型 XSS** `P1`
  - description: `uploadRoute.ts:25` — 完全信任客户端 Content-Type 头，攻击者上传 `text/html` 内容即可 XSS。修复：1）对非图片/视频/音频类型强制 `Content-Disposition: attachment`；2）可选：用 file-type 库检测 magic bytes 验证。验收：上传 text/html 文件后下载时浏览器不执行内联渲染。
  - activeForm: 修复 media Content-Type XSS
  - createdAt: 2026-02-23 15:00

- [x] `GIM-039` **修复 media 异步上传路径穿越** `P1`
  - description: `uploadRoute.ts:67` — PUT 路由的 `mediaId` 取自 URL 参数，直接传入 `path.join(MEDIA_DIR, mediaId)`。`../../etc/passwd` 可穿越到任意路径。修复：校验 mediaId 格式（`/^[A-Za-z0-9_-]{16,32}$/`），不匹配返回 400。验收：含 `..` 的 mediaId 请求返回 400。
  - activeForm: 修复 media 路径穿越
  - createdAt: 2026-02-23 15:00

- [x] `GIM-040` **修复 media 异步上传缺少所有权校验** `P1`
  - description: `uploadRoute.ts:65-113` — PUT 端点允许任何认证用户上传到任意 mediaId，包括其他用户通过 POST /create 预分配的 ID。修复：上传前校验 mediaId 不存在或属于当前用户。验收：用户 B 无法覆盖用户 A 预分配的 mediaId。
  - activeForm: 修复 media 上传所有权校验
  - createdAt: 2026-02-23 15:00

- [x] `GIM-041` **修复 cross-user signature 未做密码学验证** `P1`
  - description: `e2ee/signaturesUploadRoute.ts:74-120` — 用户 A 上传对用户 B master key 的签名时，仅检查 key ID 匹配即合并写入，未调用 `verifyEd25519Signature` 验证签名有效性。修复：在合并前调用签名验证。验收：伪造签名被拒绝，有效签名正常合并。
  - activeForm: 修复 cross-user 签名验证
  - createdAt: 2026-02-23 15:00

- [x] `GIM-042` **修复 m.key.verification.done 信任提升无服务端验证** `P1`
  - description: `e2ee/sendToDeviceRoute.ts:107-132` — trusted 设备发送 `m.key.verification.done` 即可将同用户另一设备提升为 trusted。服务端不验证 SAS 交换是否真实完成。修复：信任提升应仅通过 cross-signing self_signing_key 签名设备 key 实现（signaturesUploadRoute），移除基于 to-device 事件类型的信任提升逻辑。验收：仅发送 verification.done 事件不改变目标设备 trust state。
  - activeForm: 修复 verification trust 提升逻辑
  - createdAt: 2026-02-23 15:00

- [x] `GIM-043` **AppService token 比较改用 timing-safe** `P1`
  - description: `appservice/config.ts:219` — AS token 通过 Map.get() 和 SQL 等值比较，不抗时序攻击。修复：使用 `crypto.timingSafeEqual` 比较 token。验收：无功能变更，token 匹配逻辑不变。
  - activeForm: 修复 AppService token 比较
  - createdAt: 2026-02-23 15:00

- [x] `GIM-044` **升级 unstorage 修复 h3 请求走私 CVE** `P1`
  - description: unstorage 1.16.0 依赖的 h3 ≤1.15.4 存在请求走私漏洞（GHSA-mp2g）。修复：`bun update unstorage`。验收：`bun audit` 无 h3 相关告警。
  - activeForm: 升级 unstorage 修复 CVE
  - createdAt: 2026-02-23 15:00

- [x] `GIM-045` **修复 SSRF — push gateway 和 AppService fetch 调用** `P1`
  - description: `notification/pushGateway.ts:37` — SSRF 黑名单有缺口（十进制 IP、IPv6 映射、DNS rebinding）。`appservice/service.ts` 的 fetch 调用完全无 SSRF 防护。修复：1）解析 hostname 为 IP 后二次校验；2）为 AppService fetch 添加相同 SSRF 防护。验收：`http://2130706433/` 等绕过方式被拦截。
  - activeForm: 修复 SSRF 防护
  - createdAt: 2026-02-23 15:00

### HIGH — 正确性

- [x] `GIM-046` **修复 OTK claim 非原子导致重复分发** `P1`
  - description: `e2ee/keysClaimRoute.ts:21-32` — SELECT + UPDATE 未在事务中，并发请求可分发同一 OTK 给不同会话。修复：使用 `UPDATE ... RETURNING *` 原子 claim，或包裹在事务中。验收：并发 claim 请求不返回相同 OTK。
  - activeForm: 修复 OTK claim 原子性
  - createdAt: 2026-02-23 15:00

- [x] `GIM-047` **修复 device key upload 多步操作非事务** `P1`
  - description: `e2ee/keysUploadRoute.ts:124-233` — device key upsert、trust bootstrap、OTK 清理分三步执行，中间崩溃导致 E2EE 状态不一致。修复：包裹在单一事务中。验收：模拟中间失败后无残留状态。
  - activeForm: 修复 key upload 事务性
  - createdAt: 2026-02-23 15:00

- [x] `GIM-048` **修复 historyVisibility 死三元表达式** `P1`
  - description: `room/service.ts:45` — `preset === 'public_chat' ? 'shared' : 'shared'` 两分支相同。private_chat 应为 `'invited'`。修复：`preset === 'public_chat' ? 'shared' : 'invited'`。验收：private 房间加入后仅可见加入时刻起的历史。
  - activeForm: 修复 historyVisibility 逻辑
  - createdAt: 2026-02-23 15:00

- [x] `GIM-049` **修复 createRoom 多步事件非事务** `P1`
  - description: `room/service.ts:56-216` — 最多 11 次 `createEvent` 各自独立提交，中途失败留下半初始化房间。修复：包裹在单一事务中，通知在提交后触发。验收：模拟中间失败后数据库无残留房间。
  - activeForm: 修复 createRoom 事务性
  - createdAt: 2026-02-23 15:00

- [x] `GIM-050` **修复 hasChanges 缺少 account_data 检测** `P1`
  - description: `sync/syncGetRoute.ts:47-52` — long-poll 的 hasChanges 未检查 `account_data.events.length > 0`，导致仅有 account data 变更（push rule、m.direct 等）时 long-poll 不唤醒，延迟达 timeout 秒。修复：添加 account_data 检测。验收：修改 push rule 后 sync 立即返回。
  - activeForm: 修复 sync hasChanges 检测
  - createdAt: 2026-02-23 15:00

- [x] `GIM-051` **修复空 redirect_uri 导致 OAuth 回调崩溃** `P1`
  - description: `oauth/provider.ts:251` — 空字符串 redirect_uri 绕过验证，回调时 `new URL('')` 抛出未捕获 TypeError。修复：redirect_uri 为空或缺失时直接返回 400。验收：不带 redirect_uri 的 auth 请求返回 400 而非 500。
  - activeForm: 修复空 redirect_uri 崩溃
  - createdAt: 2026-02-23 15:00

- [x] `GIM-052` **修复 OAuth grant 撤销缓存绕过** `P1`
  - description: `oauth/provider.ts:559-561` — 先删除 DB 行再查询 DB 做缓存失效，查询返回空导致缓存 token 存活至 TTL（最长 1 小时）。修复：先失效缓存再删除 DB 行，或直接用 token ID 列表失效。验收：revoke 后 token 立即不可用。
  - activeForm: 修复 grant 撤销缓存失效
  - createdAt: 2026-02-23 15:00

- [x] `GIM-053` **修复 GET /members N+1 查询** `P1`
  - description: `room/membershipRoutes.ts:234-247` — 每个成员单独 SELECT 获取事件体。100 成员 = 101 查询。修复：用 JOIN 或 `inArray` 批量获取。验收：大房间 members 请求只发 2 条查询。
  - activeForm: 修复 members N+1 查询
  - createdAt: 2026-02-23 15:00

- [x] `GIM-054` **修复 key upload 通知 N+1 查询** `P1`
  - description: `e2ee/keysUploadRoute.ts:270-293` + `dehydratedDeviceRoute.ts:110-132` — 逐房间查询成员发通知。修复：用单条 DISTINCT 子查询获取所有共享房间的成员。验收：key upload 通知只发 1-2 条查询。
  - activeForm: 修复 key upload 通知 N+1
  - createdAt: 2026-02-23 15:00

- [x] `GIM-055` **修复 kick/ban 缺少发送者成员检查** `P1`
  - description: `room/membershipRoutes.ts:122-149`（kick）、`152-179`（ban）— 仅校验 power level 未校验 sender 是否为房间成员。修复：在 power level 检查前添加 `senderMembership !== 'join'` 检查。验收：非成员尝试 kick/ban 返回 403。
  - activeForm: 修复 kick/ban 成员检查
  - createdAt: 2026-02-23 15:00

- [x] `GIM-056` **修复 createRoomRoute 使用 body 而非 v.data** `P1`
  - description: `room/createRoomRoute.ts:25-36` — Zod 验证后使用原始 `body.*` 而非 `v.data.*`，绕过 Zod 的类型转换和字段过滤。修复：全部替换为 `v.data.*`。验收：传入未知字段不被透传到 createRoom。
  - activeForm: 修复 createRoom 使用验证后数据
  - createdAt: 2026-02-23 15:00

- [x] `GIM-057` **修复 initial_state 数组元素未验证** `P1`
  - description: `shared/validation.ts:26` — `initial_state` 定义为 `z.array(z.record(z.string(), z.unknown()))`，无结构校验。修复：定义 `z.object({ type: z.string(), state_key: z.string(), content: z.record() })` schema。验收：缺少 type 字段的 initial_state 元素被拒绝。
  - activeForm: 修复 initial_state 验证
  - createdAt: 2026-02-23 15:00

- [x] `GIM-058` **修复 OIDC 签名密钥每次重启重新生成** `P2`
  - description: `oauth/tokens.ts:12-15` — ECDSA 密钥对每次启动在内存生成，重启后所有 id_token 不可验证。修复：持久化密钥到数据库或文件，启动时加载，不存在时生成并保存。验收：重启后之前签发的 id_token 仍可验证。
  - activeForm: 持久化 OIDC 签名密钥
  - createdAt: 2026-02-23 15:00

### HIGH — Schema/性能

- [x] `GIM-059` **添加 account_data.stream_id 索引** `P1`
  - description: sync 热路径查询 `stream_id > sinceId`，当前 `(user_id, room_id)` 索引无法用于 stream_id 范围过滤。修复：添加 `(userId, roomId, streamId)` 复合索引。验收：`EXPLAIN QUERY PLAN` 显示使用索引。
  - activeForm: 添加 account_data 索引
  - createdAt: 2026-02-23 15:00

- [x] `GIM-060` **添加 push_rules.user_id 索引** `P1`
  - description: push rule 评估按 user_id 查询，无索引。修复：添加 `(userId)` 索引。验收：EXPLAIN 显示使用索引。
  - activeForm: 添加 push_rules 索引
  - createdAt: 2026-02-23 15:00

- [x] `GIM-061` **添加 account_filters.user_id 索引** `P1`
  - description: 按 userId 查询无索引。修复：添加索引。验收：EXPLAIN 显示使用索引。
  - activeForm: 添加 account_filters 索引
  - createdAt: 2026-02-23 15:00

- [x] `GIM-062` **修复 getStateContent 双查询改用 JOIN** `P2`
  - description: `models/roomState.ts:9-35` — 缓存未命中时先查 current_room_state 获取 eventId，再查 events_state 获取 content。修复：改为单条 `innerJoin` 查询。验收：缓存 miss 时只执行 1 条 SQL。
  - activeForm: 优化 getStateContent 查询
  - createdAt: 2026-02-23 15:00

- [x] `GIM-063` **修复 admin deactivate 未撤销 token** `P1`
  - description: `admin/usersRoutes.ts:74` — 停用用户仅翻转 boolean，未撤销 oauth_tokens 和 account_tokens，已停用用户 session 仍有效至自然过期。修复：停用时同时失效所有 token。验收：停用用户后其 access token 立即不可用。
  - activeForm: 修复 admin deactivate token 撤销
  - createdAt: 2026-02-23 15:00

- [x] `GIM-064` **修复 localpart 解析在 IPv6 server name 下出错** `P1`
  - description: `e2ee/keysUploadRoute.ts:180` — `auth.userId.split(':')[0]!.slice(1)` 在含冒号的 server name 下截断错误，导致 OAuth 设备查询失败，错误删除设备。修复：使用 `userId.slice(1, userId.lastIndexOf(':'))` 提取 localpart。验收：含冒号 server name 的 userId 正确提取 localpart。
  - activeForm: 修复 localpart 解析
  - createdAt: 2026-02-23 15:00

- [x] `GIM-065` **修复 powerLevelContentOverride 可覆盖 creator PL** `P1`
  - description: `room/service.ts:84` — spread 运算符 `{ [creatorId]: 100, ...overrideUsers }` 允许 override 中包含 creator ID 降低其 PL。修复：merge 后重新断言 `users[creatorId] = 100`。验收：override 含 creator PL=0 时 creator 仍为 100。
  - activeForm: 修复 creator PL 保护
  - createdAt: 2026-02-23 15:00

### HIGH — 依赖更新

- [x] `GIM-066` **更新所有过时依赖** `P1`
  - description: |
    当前过时依赖：
    - hono 4.7.10 → 4.12.2（含安全修复，见 GIM-037）
    - unstorage 1.16.0 → 1.17.4（含安全修复，见 GIM-044）
    - @aws-sdk/client-s3 3.985.0 → 3.995.0
    - @aws-sdk/s3-request-presigner 3.985.0 → 3.995.0
    - winston 3.17.0 → 3.19.0
    - yaml 2.8.0 → 2.8.2
    - @antfu/eslint-config (dev) 4.13.2 → 4.19.0
    - @types/bun (dev) 1.2.14 → 1.3.9
    - drizzle-kit (dev) 0.31.8 → 0.31.9
    - eslint (dev) 9.27.0 → 9.39.3
    - wrangler (dev) 4.63.0 → 4.67.0
    - typescript (peer) 5.8.3 → 5.9.3
    修复：`bun update --latest`，然后验证 lint + 测试通过。验收：`bun outdated` 无输出，`bun run lint` 通过。
  - activeForm: 更新过时依赖
  - createdAt: 2026-02-23 15:00

### MEDIUM（按优先级精简）

- [x] `GIM-067` **修复 requestId 头注入风险** `P2`
  - description: `shared/middleware/requestId.ts:4` — 接受任意客户端 X-Request-Id 无校验（可注入换行符到日志）。修复：仅接受 UUID 格式或字母数字，最长 64 字符。
  - activeForm: 修复 requestId 头校验
  - createdAt: 2026-02-23 15:00

- [x] `GIM-068` **修复 upstream OIDC config 永久缓存** `P2`
  - description: `oauth/provider.ts:39-56` — 上游 OIDC discovery 文档首次获取后永久缓存，endpoint 变更需重启。修复：添加 TTL（如 24h）。
  - activeForm: 修复 OIDC config 缓存 TTL
  - createdAt: 2026-02-23 15:00

- [x] `GIM-069` **修复 upstream OIDC fetch 无超时** `P2`
  - description: `oauth/provider.ts:45,373,386` — 三处 upstream OIDC fetch 无 AbortSignal 超时，上游不响应会无限阻塞。修复：添加 10s 超时。
  - activeForm: 修复 OIDC fetch 超时
  - createdAt: 2026-02-23 15:00

- [x] `GIM-070` **验证 upstream OIDC issuer 声明** `P2`
  - description: `oauth/provider.ts:41-56` — discovery 文档的 issuer 未校验是否与 IM_OIDC_ISSUER 一致。修复：比对 issuer 字段。
  - activeForm: 校验 OIDC issuer 声明
  - createdAt: 2026-02-23 15:00

- [x] `GIM-071` **验证 upstream userinfo localpart 格式** `P2`
  - description: `oauth/provider.ts:391` — upstream 返回的 preferred_username 未校验 Matrix localpart 格式。修复：用正则校验 `[a-z0-9._=/+-]+`。
  - activeForm: 校验 userinfo localpart
  - createdAt: 2026-02-23 15:00

- [x] `GIM-072` **修复 typing 清理在每次 sync 执行** `P2`
  - description: `sync/service.ts:35` — 每次 sync 请求都 DELETE 过期 typing 通知。修复：移入 cron 或节流（5s 最多执行一次）。
  - activeForm: 节流 typing 清理
  - createdAt: 2026-02-23 15:00

- [x] `GIM-073` **修复 limited flag 双查询优化** `P2`
  - description: `sync/roomData.ts:220-225` — 检测 limited 时发两条相同查询。修复：首次查询 limit+1 行，判断后截断。
  - activeForm: 优化 limited flag 检测
  - createdAt: 2026-02-23 15:00

- [x] `GIM-074` **修复 SSO 不支持移动端自定义 URI scheme** `P2`
  - description: `auth/ssoRoutes.ts:12-27` — isValidRedirectUrl 仅允许 https + http://localhost，拒绝 `element://` 等移动端 deeplink。修复：增加对自定义 scheme 的支持。
  - activeForm: 修复 SSO 移动端支持
  - createdAt: 2026-02-23 15:00

- [x] `GIM-075` **添加 typing_notifications.expires_at 索引** `P2`
  - description: 每次 sync 或 cron 执行 `DELETE WHERE expires_at <= ?` 全表扫描。修复：添加索引。
  - activeForm: 添加 typing 索引
  - createdAt: 2026-02-23 15:00

- [x] `GIM-076` **Docker 固定 bun 版本** `P2`
  - description: Dockerfile 使用 `oven/bun:latest`，构建不确定性。修复：固定为具体版本如 `oven/bun:1.2`。
  - activeForm: 固定 Docker bun 版本
  - createdAt: 2026-02-23 15:00

- [ ] `GIM-077` **添加 unit test 层** `P2`
  - description: 当前 22 个测试文件全为集成测试（需运行服务器 + 预置 token），无 model/middleware/service 层单元测试。修复：为核心逻辑（resolveToken、getTrustState、buildSyncResponse 等）添加独立单元测试。验收：测试覆盖率 ≥80%。
  - activeForm: 添加单元测试
  - createdAt: 2026-02-23 15:00

- [x] `GIM-078` **集中 process.env 到 config.ts** `P3`
  - description: 12 个文件直接访问 process.env 而非从 config.ts 导入。修复：所有 env 读取集中到 config.ts 并导出类型化常量。
  - activeForm: 集中环境变量配置
  - createdAt: 2026-02-23 15:00
