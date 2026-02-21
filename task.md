# GIM 任务清单

> 更新日期: 2026-02-21

## 使用规范

此文件是项目的持久化任务追踪，与 CLAUDE.md 中 **Project Task Tracking (Mandatory)** 规则配合使用。

### 任务模板

每个任务必须包含以下字段（对应 `TaskCreate` 参数）：

```
- [ ] **subject**: 简短祈使句标题
  - **description**: 需要做什么，包含上下文和验收标准
  - **activeForm**: 进行中时的现在进行时描述（用于 spinner 显示）
  - **blocked by**: 依赖的前置任务（可选）
  - **blocks**: 被本任务阻塞的后续任务（可选）
  - **owner**: 负责人/agent 名称（可选）
```

示例：

```
- [-] **实现 Redis Pub/Sub 通知总线**
  - description: 将 Notifier 从 EventEmitter 迁移到 Redis Pub/Sub，支持多进程同步。需修改 `app/modules/sync/notifier.ts`，新增 Redis 发布/订阅逻辑，保留内存 fallback。验收：多实例部署下 sync 通知正常送达。
  - activeForm: 实现 Redis Pub/Sub 通知总线
  - blocked by: 无
  - blocks: 多进程限流统一状态
  - owner: —
```

### 状态标记

| 标记 | 含义 | TaskUpdate status |
|------|------|-------------------|
| `[ ]` | 待办 | `pending` |
| `[-]` | 进行中 | `in_progress` |
| `[x]` | 已完成 | `completed` |
| `[~]` | 关闭/不做 | `deleted` |

### 优先级

| 标签 | 含义 |
|------|------|
| `P0` | 阻塞性问题，立即处理 |
| `P1` | 高优先级，当前迭代 |
| `P2` | 中优先级，下个迭代 |
| `P3` | 低优先级，待规划 |

### 同步规则

- **会话开始**: 读取此文件 → `TaskCreate` 创建会话任务（subject + description + activeForm 必填）
- **工作进行中**: `TaskUpdate` 设 `in_progress` + 此文件标记 `[-]`
- **任务完成**: `TaskUpdate` 设 `completed` + 此文件标记 `[x]` 移到「已完成」
- **会话结束**: 所有状态变更写回此文件，更新顶部日期

---

## 进行中

_(当前无进行中任务)_

## 待办

### P2 — 基础设施

- [ ] **实现 Federation（Server-Server）协议**
  - description: 实现 Matrix S2S API，支持跨服务器房间加入、事件联合、签名验证。涉及新模块 `app/modules/federation/`，需实现 key fetching、event signing、transaction 推送。验收：两个 gim 实例可跨域加入房间并收发消息。
  - activeForm: 实现 Federation 协议
  - blocked by: 无
  - blocks: 无

- [ ] **实现多进程同步通知总线（Notifier → Redis Pub/Sub）**
  - description: 将 `app/modules/sync/notifier.ts` 从 EventEmitter 迁移到 Redis Pub/Sub，支持多进程部署下 sync 通知。保留内存 driver 作为 fallback。验收：多实例部署时 sync long-poll 能跨进程收到通知。
  - activeForm: 实现 Redis Pub/Sub 通知总线
  - blocked by: 无
  - blocks: 多进程限流统一状态

- [ ] **实现多进程限流统一状态（RateLimit → Redis）**
  - description: 将 `app/shared/middleware/rateLimit.ts` 的计数器从内存迁移到 Redis，支持多进程共享限流状态。验收：多实例部署时限流计数一致。
  - activeForm: 实现 Redis 限流状态
  - blocked by: 多进程同步通知总线
  - blocks: 无

- [ ] **PostgreSQL 迁移路径**
  - description: 设计并实现从 SQLite 到 PostgreSQL 的迁移方案。包括：schema 兼容层（Drizzle multi-dialect）、SQL 语法差异处理、数据迁移工具。验收：同一代码可切换 SQLite/PG，数据可无损迁移。
  - activeForm: 实现 PostgreSQL 迁移路径
  - blocked by: 无
  - blocks: 无

### P2 — 运维与安全

- [ ] **实现运维工具（备份/恢复、导入导出、诊断）**
  - description: 在 `tools/` 下新增运维脚本：DB 备份/恢复（SQLite snapshot）、用户数据导入导出（JSON 格式）、服务器诊断（连接数、缓存命中率、DB 大小）。验收：可通过 CLI 完成常见运维操作。
  - activeForm: 实现运维工具
  - blocked by: 无
  - blocks: 无

- [ ] **安全加固（CSP/安全头、端点级限流、设备自动过期）**
  - description: 添加 CSP/安全响应头中间件、为敏感端点（login、register、keys/upload）配置独立限流策略、实现不活跃设备自动过期清理（cron job）。验收：安全头通过 securityheaders.com A 级、限流可按端点独立配置。
  - activeForm: 实施安全加固
  - blocked by: 无
  - blocks: 无

### P2 — E2EE

- [ ] **E2EE 深度场景补强（验证流程、密钥轮换）**
  - description: 补全 E2EE 边缘场景：完整 SAS 验证流程测试、Megolm session 密钥轮换触发逻辑、跨设备验证状态同步。新增对应集成测试。验收：Element Web/Android 完成完整验证流程无报错。
  - activeForm: 补强 E2EE 深度场景
  - blocked by: 无
  - blocks: 无

## 已完成

- [x] **Cross-signing trust 失效修复，缓存 joined members，并行批量删除**
- [x] **Token 缓存与重建工具**
- [x] **性能优化：缓存 auth trust state、account status、room state、membership**
- [x] **抽取 model 层（room state、membership、device、account）**
- [x] **统一缓存层 unstorage，抽取 auth model，修复审计 bug**
- [x] **更新 `docs/architecture.md`（包含 key backup 关闭策略）**
- [x] **合并 PR #9 到 `main`**
- [x] **E2EE `keys/upload` 增加非生产兼容模式**
- [x] **修复 To-Device 相关设备选择稳定性**
- [x] **增强 AppService 缓存回填**
- [x] **修复 AppService 测试引导**
- [x] **修复 Sliding Sync 增量房间 timeline**
- [x] **修复 Threads (MSC3440) 中 `m.relates_to` JSON 路径解析**
- [x] **修复 Notifications 事件查询（`$event_id` 归一化）**

## 关闭项

- [~] **服务端 Room Key Backup（`/room_keys/version*`）**
  - description: 架构策略为关闭，不提供服务端密钥备份能力，接口保持 `M_NOT_FOUND`。
  - activeForm: —
