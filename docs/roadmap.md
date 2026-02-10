# GIM 改进路线图

> 版本: 0.1.0-beta.1 | 最后更新: 2026-02

## 1. 已发现问题清单

### 1.1 严重级别（需优先修复）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| S1 | **进程内状态阻止水平扩展** — Sync Notifier 使用 EventEmitter，SSO/OAuth 状态存在内存 Map，限流器使用内存 Map | sync/notifier.ts, auth/routes.ts, oauth/provider.ts, rateLimit.ts, media/routes.ts | 无法多进程部署 |
| S2 | **缺失数据库索引** — oauthTokens、e2eeToDeviceMessages、e2eeOneTimeKeys、media、mediaDeletions、pushNotifications、roomMembers 等表缺少关键索引 | db/schema.ts | 大数据量时查询性能急剧下降 |
| S3 | **N+1 查询问题** — 事件关系聚合、房间成员列表、未读计数、室友在线状态、已读回执均存在 N+1 模式 | helpers/eventQueries.ts, formatEvent.ts, notification/service.ts, presence/service.ts | 房间多/成员多时同步延迟飙升 |
| S4 | **设备删除/账号停用非事务性** — 多步 DELETE 操作没有事务包裹，中断会导致数据不一致 | device/routes.ts, account/routes.ts | 异常时产生孤儿数据 |

### 1.2 高级别问题

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| H1 | **auth middleware 每请求写入 devices** — 每个请求都更新设备的 lastSeenAt 和 ipAddress | shared/middleware/auth.ts | 写入放大，SQLite 写入锁压力 |
| H2 | **事件查询双表合并在内存执行** — queryRoomEvents 分别查两张表再内存排序合并 | helpers/eventQueries.ts | 大房间内存消耗高 |
| H3 | **媒体配额 TOCTOU 竞态** — 先检查配额再写入，并发上传可超额 | media/routes.ts | 存储超限 |
| H4 | **SSO 回调状态 10 分钟 TTL** — 清理间隔 5 分钟，最多残留 15 分钟 | auth/routes.ts, oauth/provider.ts | 内存泄漏（低速率） |
| H5 | **缺失外键约束** — accountTokens、media、oauthTokens 等表未设外键 | db/schema.ts | 数据孤儿风险 |
| H6 | **Cron 任务无错误处理** — cleanupOrphanedE2eeKeys/cleanupExpiredTokens 没有 try-catch | cron.ts | 静默失败，孤儿数据堆积 |

### 1.3 中级别问题

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| M1 | 推送规则签名上传不验证签名内容 | e2ee/routes.ts | 可注入虚假签名 |
| M2 | notifyUser() 在循环中逐个调用 | e2ee/routes.ts, message/service.ts | 通知风暴 |
| M3 | 管理面板 Token 存 localStorage | admin/src/api.ts | XSS 可窃取管理权限 |
| M4 | 媒体文件名清理不完整 | media/routes.ts | null 字节/路径遍历风险 |
| M5 | 测试覆盖不足 — 无 E2EE 验证流程测试、无媒体测试、无管理 API 测试 | tests/ | 回归风险 |
| M6 | presence 变更不通知共享房间成员 | presence/service.ts | 在线状态延迟感知 |
| M7 | createRoomBody 使用 passthrough() | shared/validation.ts | 允许任意额外字段 |

### 1.4 低级别问题

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| L1 | metrics 指标仅内存存储 | shared/metrics.ts | 重启丢失 |
| L2 | 管理面板缺少操作确认弹窗 | admin/src/routes/ | 误操作风险 |
| L3 | 管理面板无活动审计日志 | admin/ | 无法追溯管理操作 |
| L4 | 管理面板搜索使用 LIKE %keyword% | admin/routes.ts | 无法利用索引 |

---

## 2. 改进路线图

### Phase 1: 稳定性加固（短期，1-2 个月）

**目标：** 修复关键缺陷，提升数据一致性和查询性能

#### 1.1 数据库索引补全 [S2]

为高频查询路径添加必要索引：

```
优先级排序:
1. oauthTokens (type, accountId) — 每请求认证
2. e2eeToDeviceMessages (userId, deviceId) — 每次同步
3. e2eeOneTimeKeys (userId, deviceId, claimed) — E2EE 密钥认领
4. roomMembers (userId, membership) — 房间列表查询
5. media (userId) — 配额检查
6. mediaDeletions (completedAt) — cron 任务查询
7. pushNotifications (userId, read) — 通知查询
8. oauthTokens (grantId) — token 吊销
```

#### 1.2 事务性保障 [S4]

```
- 设备删除操作包裹事务
- 账号停用操作包裹事务
- 登出所有设备操作包裹事务
```

#### 1.3 Cron 错误处理 [H6]

```
- 所有 cron 任务添加 try-catch + error 级别日志
- 考虑添加重试逻辑（指数退避）
```

#### 1.4 减少设备写入放大 [H1]

```
方案: 节流更新 — 仅在 lastSeenAt 超过 5 分钟时才写入
效果: 减少 ~95% 的设备更新写入
```

#### 1.5 添加缺失外键 [H5]

```
优先:
- accountTokens.userId → accounts.id
- media.userId → accounts.id
- oauthTokens.accountId → accounts.id (需处理格式差异)
```

---

### Phase 2: 性能优化（短期至中期，2-4 个月）

**目标：** 消除 N+1 查询，提升同步性能

#### 2.1 事件查询优化 [H2, S3]

```
当前: 两表分查 + 内存合并
目标: SQL UNION ALL + ORDER BY + LIMIT

当前 formatEventWithRelations: 每事件单独查关系
目标: 批量查询所有关系 → Map 映射
```

#### 2.2 同步查询批量化 [S3]

```
当前: 逐房间查询 timeline/state/receipts/notifications
目标:
  - 批量查询所有房间增量事件
  - 批量查询未读计数（单条 SQL）
  - 批量查询已读回执
```

#### 2.3 缓存热数据

```
缓存候选:
  - 房间当前状态 (currentRoomState) — TTL 5min
  - 用户权限级别 — TTL 1min (权限变更时失效)
  - 推送规则 — TTL 10min (规则变更时失效)
  - 配额统计 — TTL 1min
```

#### 2.4 媒体配额原子化 [H3]

```
方案: 使用事务 + SELECT FOR UPDATE 模式
  或: 先插入 media 记录（fileSize=0），上传成功后更新 fileSize
```

---

### Phase 3: 可扩展性（中期，3-6 个月）

**目标：** 支持多进程部署，提升系统上限

#### 3.1 状态外部化 [S1]

```
阶段 A: Notifier → Redis Pub/Sub
  - 替换 EventEmitter 为 Redis SUBSCRIBE/PUBLISH
  - 复用 unstorage Redis 驱动连接

阶段 B: 限流器 → Redis
  - 使用 Redis INCR + EXPIRE 实现分布式限流

阶段 C: Auth States → Redis
  - SSO 流程状态存入 Redis (10min TTL)
  - OAuth 授权状态存入 Redis
```

#### 3.2 容器化

```
- 创建多阶段 Dockerfile
- 创建 docker-compose.yml (app + Redis)
- 添加健康检查配置
- 文档化生产部署流程
```

#### 3.3 可观测性增强

```
- Prometheus 指标端点
  - http_request_duration_seconds (直方图)
  - db_query_count / db_query_duration
  - sync_wait_duration
  - e2ee_otk_count (OTK 库存)
  - active_sync_connections (当前长轮询数)

- 结构化日志增强
  - 添加 trace_id 贯穿请求链
  - 数据库查询日志（开发模式）
```

---

### Phase 4: 功能完善（中期至长期，4-8 个月）

**目标：** 补全 Matrix 协议覆盖，增强管理能力

#### 4.1 协议功能补全

| 功能 | MSC | 优先级 | 说明 |
|------|-----|--------|------|
| Sliding Sync | MSC3575 | 高 | 大幅改善客户端体验 |
| 线程消息 | MSC3440 | 高 | 现代 IM 必需 |
| 密钥备份 | MSC2697 | 中 | E2EE 设备恢复 |
| 缩略图生成 | — | 中 | 媒体体验优化 |
| 推送网关 | — | 中 | 实际推送通知能力 |
| URL 预览 | — | 低 | 当前是 stub |
| 密码登录 | — | 低 | 替代 SSO 的登录方式 |

#### 4.2 管理面板增强

```
Phase 4a: 基础增强
  - 用户创建/密码重置
  - 房间状态查看/编辑
  - 设备管理（登出/删除）
  - 操作确认对话框
  - 错误提示优化

Phase 4b: 高级功能
  - 数据可视化 (活跃用户趋势、消息量图表)
  - 审计日志
  - 批量操作
  - 全局搜索
```

#### 4.3 测试覆盖提升 [M5]

```
补充测试:
  - E2EE 完整验证流程 (SAS + 交叉签名)
  - To-device 消息排序
  - 设备列表变更追踪
  - 媒体上传/下载/配额
  - 管理 API 端点
  - 在线状态
  - 长轮询超时场景
  - 并发操作竞态测试
```

---

### Phase 5: 生产就绪（长期，6-12 个月）

**目标：** 生产级部署能力

#### 5.1 数据库升级路径

```
准备 PostgreSQL 迁移:
  - 编写 PG 兼容 schema（类型映射）
  - 迁移 4 处 raw SQL
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
- 管理 Token 改用 httpOnly Cookie
- 添加 CSP/安全头
- 速率限制精细化（按端点）
- 审计日志持久化
- 自动过期不活跃设备
```

---

## 3. 技术债务总结

### 代码质量

| 类别 | 数量 | 示例 |
|------|------|------|
| N+1 查询 | 6 处 | 事件关系、成员列表、未读计数、在线状态、已读回执、通知 |
| 缺失事务 | 3 处 | 设备删除、账号停用、全设备登出 |
| 内存状态 | 5 处 | Notifier、SSO State、OAuth State、Rate Limit、Upload Window |
| 缺失索引 | 12 个 | 见数据库文档 |
| 缺失外键 | 3 个 | accountTokens、media、oauthTokens |
| 缺失错误处理 | 3 处 | cron 任务、缓存层、S3 操作 |

### 测试债务

| 类别 | 有测试 | 无测试 |
|------|--------|--------|
| 房间管理 | ✅ | |
| 消息 | ✅ | |
| 同步 | ✅ | 长轮询超时 |
| E2EE 基础 | ✅ | 验证流程、密钥轮换 |
| 媒体 | | ❌ 完全缺失 |
| 管理 API | | ❌ 完全缺失 |
| 在线状态 | | ❌ 完全缺失 |
| 设备列表变更 | | ❌ 完全缺失 |
| To-device 排序 | | ❌ 完全缺失 |
| 并发竞态 | | ❌ 完全缺失 |

---

## 4. 关键里程碑

```
v0.1.1  ─── 索引补全 + 事务修复 + Cron 错误处理
v0.1.2  ─── N+1 查询消除 + 设备写入节流 + 缓存层应用
v0.2.0  ─── Redis 状态外部化 + Docker 支持
v0.3.0  ─── Sliding Sync + 线程消息
v0.4.0  ─── 管理面板增强 + 审计日志
v1.0.0  ─── 生产就绪（PG 可选、完整测试、运维工具）
```
