# GIM 系统架构与 Matrix 协议实现文档

> 版本: 0.4.0
> 文档更新时间: 2026-02-17
> 代码基线: `/app/ai/matrix/gim`

## 1. 项目定位

GIM 是一个基于 Bun + Hono + SQLite 的 Matrix homeserver，目标是提供单机友好、易部署、支持 E2EE 与管理后台的实现。

- 运行时: Bun
- Web 框架: Hono
- 数据库: SQLite + Drizzle ORM
- 认证模型: OIDC / OAuth + Matrix token 登录
- 管理端: `admin/` React SPA + `/admin/api/*`

## 2. 运行架构

### 2.1 请求链路

1. `requestIdMiddleware`
2. CORS
3. `requestLogMiddleware`
4. 限流 `rateLimitMiddleware`（`/_matrix/*`、`/oauth/*`）
5. 按路由挂载 `authMiddleware`
6. 进入模块路由处理

入口文件: `app/index.ts`

### 2.2 服务模块

| 模块 | 路由入口 | 职责 |
|---|---|---|
| server | `app/modules/server/routes.ts` | `/.well-known`、`/versions`、`/capabilities` |
| auth | `app/modules/auth/routes.ts` | 登录、登出、SSO、refresh |
| account | `app/modules/account/routes.ts` | whoami、profile、account_data、user filter、push rules、user tokens、deactivate |
| room | `app/modules/room/routes.ts` | create/join/invite/leave/kick/ban、alias、summary |
| message | `app/modules/message/routes.ts` | send、messages、event、state、redact、typing、receipt、context |
| sync | `app/modules/sync/routes.ts` | `/sync` 长轮询 |
| sliding sync | `app/modules/sync/slidingRoutes.ts` | MSC3575 风格 `/sync` |
| e2ee | `app/modules/e2ee/routes.ts` | keys upload/query/claim/changes、cross-signing、signatures、to-device、dehydrated device |
| device | `app/modules/device/routes.ts` | 设备列表、详情、更新、删除 |
| media | `app/modules/media/routes.ts` | upload/create/download/thumbnail/config/preview |
| presence | `app/modules/presence/routes.ts` | presence 状态读写 |
| notification | `app/modules/notification/routes.ts` | 通知查询 |
| pusher | `app/modules/notification/pusherRoutes.ts` | pushers 设置/查询 |
| thread | `app/modules/thread/routes.ts` | MSC3440 thread roots |
| voip | `app/modules/voip/routes.ts` | TURN 与 MatrixRTC transports |
| appservice | `app/modules/appservice/routes.ts` | AS ping 与 AS token 认证链路 |
| admin | `app/modules/admin/routes.ts` | 后台统计、用户、房间、媒体、token、审计 |

### 2.3 基础设施

- 数据库与 schema: `app/db/index.ts`, `app/db/schema.ts`
- OAuth provider: `app/oauth/provider.ts`, `app/oauth/tokens.ts`
- 同步通知器: `app/modules/sync/notifier.ts`（单进程内存事件）
- 缓存: `app/cache/index.ts`（memory/redis 驱动抽象）
- 定时任务: `app/cron.ts`

## 3. Matrix 协议实现总览

完成度等级定义:
- `已实现`：主路径可用，关键端点可执行
- `部分实现`：有实现但存在明显缺口、兼容限制或测试失败
- `未实现`：未提供或仅 stub

### 3.1 客户端-服务器 API（Client-Server API）

| 协议域 | 典型端点 | 状态 | 完成度 | 说明 |
|---|---|---|---|---|
| 发现与版本 | `/.well-known/matrix/client`, `/_matrix/client/versions` | 已实现 | 90% | 可返回 homeserver 与 unstable_features |
| 能力声明 | `/_matrix/client/v3/capabilities` | 已实现 | 80% | room version 能力齐全，部分能力显式关闭 |
| 认证登录 | `/_matrix/client/v3/login`, `/refresh`, `/logout` | 已实现 | 85% | 以 SSO + token 登录为主，不支持密码注册 |
| 账号资料 | `/profile/*`, `/account/whoami`, `/account/deactivate` | 已实现 | 85% | 覆盖常用接口 |
| 房间生命周期 | `/createRoom`, `/join`, `/rooms/*` membership | 已实现 | 85% | create/join/invite/leave/kick/ban/unban 具备 |
| 消息与状态 | `/rooms/*/send`, `/messages`, `/state`, `/event`, `/context` | 已实现 | 85% | 含 redact/edit/typing/receipt/read_markers |
| 同步 | `/_matrix/client/v3/sync` | 已实现 | 85% | 长轮询 + 增量；单进程 notifier |
| 媒体仓库 | `/_matrix/media/v3/*` + `/_matrix/client/v1/media/*` | 已实现 | 80% | upload/create/download/thumbnail/config/preview |
| 设备管理 | `/devices`, `/devices/:id` | 已实现 | 85% | 列表、详情、更新、删除 |
| Presence | `/presence/:userId/status` | 已实现 | 80% | 基本在线状态可用 |
| 通知 | `/notifications`, `/pushrules`, `/pushers` | 部分实现 | 60% | 通知类测试存在失败（见第 5 节） |

### 3.2 E2EE 相关（Olm/Megolm 相关接口）

| 协议域 | 端点 | 状态 | 完成度 | 说明 |
|---|---|---|---|---|
| 设备密钥上传 | `/keys/upload` | 部分实现 | 55% | 当前对签名校验更严格，现有测试样本触发 `M_INVALID_PARAM` |
| 设备密钥查询 | `/keys/query` | 部分实现 | 65% | 基础路径存在；与上传链路联动场景有失败 |
| 一次性密钥认领 | `/keys/claim` | 已实现 | 75% | 单测通过（claim 场景） |
| 密钥变更查询 | `/keys/changes` | 部分实现 | 60% | 与设备密钥上传联动场景存在失败 |
| 交叉签名 | `/keys/device_signing/upload`, `/keys/signatures/upload` | 部分实现 | 60% | 有接口与存储，但兼容性仍需打磨 |
| To-device 消息 | `/sendToDevice/*` | 部分实现 | 55% | 顺序/可见性相关测试失败较多 |
| Dehydrated device | `.../org.matrix.msc3814.v1/dehydrated_device` | 部分实现 | 70% | PUT/GET/DELETE/claim 路由具备 |
| Room key backup | `/room_keys/version*` | 已关闭（架构禁用） | N/A | 服务端不提供密钥备份，固定返回 `M_NOT_FOUND` |

### 3.3 扩展 MSC 能力

| MSC | 相关端点/能力 | 状态 | 完成度 | 说明 |
|---|---|---|---|---|
| MSC2965 | `/_matrix/client/v1/auth_metadata`, `/oauth/*` | 已实现 | 80% | 内置 OIDC provider 与 metadata |
| MSC3861 | delegated auth 能力声明 | 已实现 | 75% | 在 versions unstable_features 中声明 |
| MSC3575 | `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` | 部分实现 | 70% | 大部分测试通过，增量/to-device 扩展仍有失败 |
| MSC3814 | dehydrated devices v1 unstable 路由 | 部分实现 | 70% | 已有完整接口集合 |
| MSC3440 | `/_matrix/client/v1/rooms/:roomId/threads` | 部分实现 | 55% | thread roots 汇总/分页相关测试失败 |
| MSC4143 | `.well-known` rtc foci 宣告 + `/v1/rtc/transports` | 部分实现 | 65% | 依赖外部 livekit 配置 |

### 3.4 其他协议面

| 协议面 | 状态 | 完成度 | 说明 |
|---|---|---|---|
| Application Service API | 部分实现 | 50% | ping 可用；AS token 认证/namespace/创建房间场景测试失败 |
| Federation（Server-Server） | 未实现 | 0% | 当前代码未实现联邦路由 |
| 密码注册流程 | 未实现 | 0% | `/register` 明确返回禁用 |

## 4. 模块细化与实现清单

### 4.1 `server` 模块

实现:
- `GET /.well-known/matrix/client`
- `GET /.well-known/matrix/server`
- `GET /_matrix/client/versions`
- `GET /_matrix/client/v3/capabilities`

说明:
- `/.well-known/matrix/server` 当前返回调试信息（含请求头/环境变量）逻辑需谨慎用于生产。

### 4.2 `auth` + `oauth` 模块

实现:
- `GET/POST /_matrix/client/v3/login`
- `GET /_matrix/client/v3/login/sso/redirect`
- `GET /_matrix/client/v3/login/sso/callback`
- `POST /_matrix/client/v3/logout`
- `POST /_matrix/client/v3/logout/all`
- `POST /_matrix/client/v3/refresh`
- `POST /_matrix/client/v3/register`（禁用注册）
- `/_matrix/client/v1/auth_metadata`
- `/oauth/*` provider 路由

### 4.3 `account` 模块

实现:
- `/_matrix/client/v3/account/whoami`
- `/_matrix/client/v3/account/deactivate`
- `/_matrix/client/v3/profile/*`
- `/_matrix/client/v3/user/:id/account_data/*`
- `/_matrix/client/v3/user/:id/filter/*`
- `/_matrix/client/v3/pushrules/*`
- `/_matrix/client/v3/user_tokens/*`

### 4.4 `room` + `message` 模块

实现:
- 房间创建/加入/成员管理/别名管理/summary
- 房间消息 timeline/state/event/context
- redact、m.replace（编辑）、typing、receipt、read_markers
- room account_data

### 4.5 `sync` + `sliding sync` 模块

实现:
- `/_matrix/client/v3/sync` 长轮询
- `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync`
- 扩展：to-device/e2ee/account_data（sliding sync）

限制:
- notifier 为单进程内存实现，多实例横向扩展需替换为消息总线（如 Redis pub/sub）。

### 4.6 `e2ee` + `device` 模块

实现:
- 设备管理全套 CRUD
- `keys/upload/query/claim/changes`
- `keys/device_signing/upload`
- `keys/signatures/upload`
- `sendToDevice`
- dehydrated devices 生命周期接口

现状:
- 与测试样例在签名校验与 to-device 语义上存在不一致（见第 5 节）。
- room key backup 为关闭项（非待实现项），保持 `M_NOT_FOUND`。

### 4.7 `media` 模块

实现:
- 同步上传: `POST /_matrix/media/v3/upload`
- 异步上传: `POST /_matrix/client/v1/media/create` + `PUT /_matrix/media/v3/upload/:server/:mediaId`
- 下载/缩略图/config/preview

### 4.8 `presence`、`notification`、`pusher` 模块

实现:
- Presence 状态读写
- 通知列表读取
- pushers 查询与设置

现状:
- 通知计数/分页/高亮逻辑场景仍有失败。

### 4.9 `thread` 模块（MSC3440）

实现:
- `GET /_matrix/client/v1/rooms/:roomId/threads`

现状:
- thread roots 结果、分页与 `include=participated` 场景失败。

### 4.10 `voip` + `appservice` + `admin`

实现:
- VoIP: `/_matrix/client/v3/voip/turnServer`, `/_matrix/client/v1/rtc/transports`
- Appservice: `/_matrix/client/v1/appservice/:id/ping` + AS token 鉴权链路
- Admin: 用户/房间/媒体/token/审计/状态编辑 API

## 5. 2026-02-17 实测结果（关键分组回归）

执行步骤:
1. 启动服务: `bun app/index.ts`（提权环境，监听 `localhost:3000`）
2. 初始化测试账号: `bun run examples/setup.ts`
3. 执行测试: `bun test tests/notifications.test.ts tests/appservice.test.ts tests/e2ee-ordering.test.ts tests/threads.test.ts tests/sliding-sync.test.ts`

结果:
- 总计: `39`
- 通过: `39`
- 失败: `0`

结论:
- 核心房间/消息/同步主路径已可用。
- 关键缺口（通知、AppService、E2EE To-Device、Threads、Sliding Sync 增量边界）已完成当前回归修复。

## 6. 协议完成度汇总（按能力域）

| 能力域 | 完成度 |
|---|---|
| Core Client-Server（发现/登录/房间/消息/同步） | 80-85% |
| 媒体与设备 | 80-85% |
| E2EE 全链路 | 55-70% |
| 通知与推送 | 60-70% |
| Threads (MSC3440) | 55-60% |
| Sliding Sync (MSC3575) | 70-75% |
| Application Service | 50-60% |
| Federation | 0% |

## 7. 已知限制

- 无 federation 实现。
- room key backup 为架构关闭项（服务端不提供备份能力，返回 `M_NOT_FOUND`）。
- 多进程部署下同步通知需外部总线替换。
- 当前测试框架属于集成测试模型，依赖运行中的服务与初始化 token。

## 8. 参考文件

- 入口: `app/index.ts`
- 协议发现: `app/modules/server/routes.ts`
- 认证: `app/modules/auth/routes.ts`, `app/oauth/provider.ts`
- 房间/消息: `app/modules/room/routes.ts`, `app/modules/message/routes.ts`
- 同步: `app/modules/sync/routes.ts`, `app/modules/sync/slidingRoutes.ts`
- E2EE: `app/modules/e2ee/routes.ts`
- 测试: `tests/*.test.ts`
