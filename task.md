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

- [ ] `GIM-006` **安全加固（CSP/安全头、端点级限流、设备自动过期）** `P2`
  - description: 添加 CSP/安全响应头中间件、为敏感端点（login、register、keys/upload）配置独立限流策略、实现不活跃设备自动过期清理（cron job）。验收：安全头通过 securityheaders.com A 级、限流可按端点独立配置。
  - activeForm: Implementing security hardening
  - createdAt: 2026-02-20 00:00

- [ ] `GIM-007` **E2EE 深度场景补强（验证流程、密钥轮换）** `P2`
  - description: 补全 E2EE 边缘场景：完整 SAS 验证流程测试、Megolm session 密钥轮换触发逻辑、跨设备验证状态同步。新增对应集成测试。验收：Element Web/Android 完成完整验证流程无报错。
  - activeForm: Strengthening E2EE edge cases
  - createdAt: 2026-02-20 00:00

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
