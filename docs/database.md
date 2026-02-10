# GIM 数据库设计文档

> 版本: 0.1.0-beta.1 | 最后更新: 2026-02

## 1. 数据库选型与配置

### 1.1 SQLite + WAL 模式

GIM 使用 SQLite 作为主数据库，通过 Drizzle ORM 进行访问。

**当前 PRAGMA 配置：**

```sql
PRAGMA journal_mode = WAL;    -- 写前日志，支持并发读
PRAGMA foreign_keys = ON;     -- 强制外键约束
PRAGMA busy_timeout = 5000;   -- 锁等待超时 5 秒
```

**选型理由：**
- 零运维，单文件部署
- Bun 内置 SQLite 驱动，零额外依赖
- WAL 模式支持并发读写
- 适合单进程部署架构

**适用规模：**
- 用户数：< 10,000
- 并发连接：< 1,000
- 数据量：< 50GB

### 1.2 连接管理

```typescript
// app/db/index.ts
const sqlite = new Database(dbPath)  // 单一连接实例（单例）
const db = drizzle(sqlite, { schema })
```

- 不使用连接池（SQLite 单写多读，Bun 单进程适配）
- 通过 Drizzle ORM 提供类型安全的查询接口
- 同时保留 `sqlite` 原始连接用于 raw SQL

---

## 2. 表结构设计

### 2.1 ER 图（逻辑关系）

```
accounts ─────────┬──── accountData
  │               ├──── accountTokens      (⚠ 缺少 FK)
  │               ├──── accountFilters
  │               ├──── devices ──────────── e2eeDeviceKeys    (⚠ 缺少 FK)
  │               │        │                 e2eeOneTimeKeys   (⚠ 缺少 FK)
  │               │        │                 e2eeFallbackKeys  (⚠ 缺少 FK)
  │               │        │                 e2eeToDeviceMessages (⚠ 缺少 FK)
  │               ├──── e2eeCrossSigningKeys (⚠ 缺少 FK)
  │               ├──── e2eeDehydratedDevices
  │               ├──── pushRules
  │               └──── presence
  │
  ├── roomMembers ◄────── rooms ──── roomAliases
  │                         │
  │                    eventsState ──── currentRoomState
  │                    eventsTimeline
  │                    eventsAttachments
  │
  ├── oauthTokens       (⚠ 缺少 FK)
  ├── media              (⚠ 缺少 FK)
  ├── mediaDeletions
  ├── pushNotifications  (⚠ 缺少 FK)
  ├── readReceipts       (⚠ 缺少 FK)
  ├── typingNotifications
  └── e2eeDeviceListChanges (⚠ 缺少 FK)
```

### 2.2 完整表结构

#### 用户与认证

**accounts** — 用户主表
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | Matrix 用户 ID（@user:server） |
| displayname | TEXT | nullable | 显示名称 |
| avatarUrl | TEXT | nullable | 头像 mxc:// URI |
| createdAt | INTEGER | NOT NULL | 创建时间戳 (ms) |
| isGuest | INTEGER | DEFAULT 0 | 是否访客 |
| isDeactivated | INTEGER | DEFAULT 0 | 是否已停用 |
| admin | INTEGER | DEFAULT 0 | 是否管理员 |

**accountTokens** — 长期 Bot Token
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| token | TEXT | PK | Token 值 |
| userId | TEXT | NOT NULL | 用户 ID（⚠ 无 FK） |
| deviceId | TEXT | NOT NULL | 设备 ID |
| name | TEXT | NOT NULL | Token 名称 |
| createdAt | INTEGER | NOT NULL | 创建时间 |
| lastUsedAt | INTEGER | nullable | 最后使用时间 |

**accountData** — 用户/房间级别配置数据
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| userId | TEXT | PK, FK→accounts | 用户 ID |
| type | TEXT | PK | 数据类型 |
| roomId | TEXT | PK, DEFAULT '' | 房间 ID（空=全局） |
| content | TEXT (JSON) | | 数据内容 |

**accountFilters** — 同步过滤器
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID |
| userId | TEXT | FK→accounts | 用户 ID |
| filterJson | TEXT (JSON) | | 过滤器定义 |

**oauthTokens** — OAuth Token（统一存储所有类型）
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | 格式: "{Type}:{jti}" |
| type | TEXT | | AccessToken/RefreshToken/Grant/AuthorizationCode |
| accountId | TEXT | nullable | 用户 localpart（⚠ 非完整 Matrix ID） |
| deviceId | TEXT | nullable | 绑定设备 |
| clientId | TEXT | nullable | 客户端 ID |
| scope | TEXT | nullable | 授权范围 |
| grantId | TEXT | nullable | 关联 Grant |
| payload | TEXT (JSON) | DEFAULT '{}' | 额外负载 |
| expiresAt | INTEGER | nullable | 过期时间 |
| consumedAt | INTEGER | nullable | 消费时间（一次性 token） |

#### 设备

**devices** — 用户设备
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| userId | TEXT | PK, FK→accounts | 用户 ID |
| id | TEXT | PK | 设备 ID |
| displayName | TEXT | nullable | 设备显示名 |
| ipAddress | TEXT | nullable | 最后 IP |
| userAgent | TEXT | nullable | 最后 UA |
| createdAt | INTEGER | NOT NULL | 创建时间 |
| lastSeenAt | INTEGER | nullable | 最后活跃时间 |
| lastToDeviceStreamId | INTEGER | DEFAULT 0 | 已读 to-device 消息位置 |
| lastSyncBatch | TEXT | nullable | 上次 sync 的 next_batch |
| pendingKeyChange | INTEGER | DEFAULT 0 | 是否有待通知的密钥变更 |

#### 房间

**rooms** — 房间主表
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | 房间 ID（!xxx:server） |
| version | TEXT | DEFAULT '12' | 房间版本 |
| creatorId | TEXT | NOT NULL | 创建者（⚠ 无 FK） |
| isDirect | INTEGER | DEFAULT 0 | 是否私信 |
| createdAt | INTEGER | NOT NULL | 创建时间 |

**roomMembers** — 房间成员关系
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| roomId | TEXT | PK, FK→rooms | 房间 ID |
| userId | TEXT | PK, FK→accounts | 用户 ID |
| membership | TEXT | NOT NULL | join/invite/leave/ban/knock |
| eventId | TEXT | NOT NULL | 关联的成员事件 ID |
| updatedAt | INTEGER | NOT NULL | 更新时间 |

**roomAliases** — 房间别名
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| alias | TEXT | PK | 别名（#room:server） |
| roomId | TEXT | FK→rooms | 房间 ID |

#### 事件（核心双表设计）

**eventsState** — 状态事件
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID（排序键） |
| roomId | TEXT | NOT NULL | 房间 ID |
| sender | TEXT | NOT NULL | 发送者 |
| type | TEXT | NOT NULL | 事件类型 |
| stateKey | TEXT | NOT NULL | 状态键 |
| content | TEXT (JSON) | | 事件内容 |
| originServerTs | INTEGER | | 服务端时间戳 |
| unsigned | TEXT (JSON) | nullable | 附加元数据 |
| **索引:** | (roomId, id) | | 房间内事件查询 |

**eventsTimeline** — 时间线事件
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID（排序键） |
| roomId | TEXT | NOT NULL | 房间 ID |
| sender | TEXT | NOT NULL | 发送者 |
| type | TEXT | NOT NULL | 事件类型 |
| content | TEXT (JSON) | | 事件内容 |
| originServerTs | INTEGER | | 服务端时间戳 |
| unsigned | TEXT (JSON) | nullable | 附加元数据 |
| **索引:** | (roomId, id) | | 房间内事件查询 |

**currentRoomState** — 当前状态物化表
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| roomId | TEXT | PK, FK→rooms | 房间 ID |
| type | TEXT | PK | 事件类型 |
| stateKey | TEXT | PK, DEFAULT '' | 状态键 |
| eventId | TEXT | FK→eventsState | 当前生效的事件 |

**eventsAttachments** — 事件媒体关联
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID |
| eventId | TEXT | NOT NULL | 事件 ID |
| mediaId | TEXT | NOT NULL | 媒体 ID |
| createdAt | INTEGER | | 创建时间 |
| **索引:** | (eventId), (mediaId) | | 双向查询 |

#### E2EE（6 张表）

**e2eeDeviceKeys** — 设备身份密钥
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| userId | TEXT | PK | 用户 ID |
| deviceId | TEXT | PK | 设备 ID |
| algorithms | TEXT (JSON) | | 支持的算法列表 |
| keys | TEXT (JSON) | | 公钥映射 |
| signatures | TEXT (JSON) | | 签名数据 |
| displayName | TEXT | nullable | 设备显示名 |

**e2eeOneTimeKeys** — 一次性密钥
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID |
| userId | TEXT | NOT NULL | 用户 ID |
| deviceId | TEXT | NOT NULL | 设备 ID |
| algorithm | TEXT | NOT NULL | 算法 |
| keyId | TEXT | NOT NULL | 密钥 ID |
| keyJson | TEXT (JSON) | | 密钥数据 |
| claimed | INTEGER | DEFAULT 0 | 是否已认领 |

**e2eeFallbackKeys** — 备用密钥
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| userId | TEXT | PK | 用户 ID |
| deviceId | TEXT | PK | 设备 ID |
| algorithm | TEXT | PK | 算法 |
| keyId | TEXT | NOT NULL | 密钥 ID |
| keyJson | TEXT (JSON) | | 密钥数据 |

**e2eeCrossSigningKeys** — 交叉签名密钥
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| userId | TEXT | PK | 用户 ID |
| keyType | TEXT | PK | master/self_signing/user_signing |
| keyData | TEXT (JSON) | | 密钥数据 |

**e2eeToDeviceMessages** — 设备间消息队列
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, auto-increment | **严格递增排序键** |
| userId | TEXT | NOT NULL | 接收者 |
| deviceId | TEXT | NOT NULL | 接收设备 |
| type | TEXT | NOT NULL | 消息类型 |
| content | TEXT (JSON) | | 消息内容 |
| sender | TEXT | NOT NULL | 发送者 |

> **关键设计决策：** to-device 消息使用 auto-increment integer 而非 ULID，确保严格的消息顺序。这对 E2EE 会话建立至关重要。

**e2eeDeviceListChanges** — 设备列表变更追踪
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, auto-increment | 自增 ID |
| userId | TEXT | NOT NULL | 变更用户 |
| ulid | TEXT | NOT NULL | 变更排序标识 |

#### 媒体

**media** — 媒体文件元数据
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | 媒体 ID |
| userId | TEXT | NOT NULL | 上传者（⚠ 无 FK） |
| contentType | TEXT | NOT NULL | MIME 类型 |
| fileName | TEXT | nullable | 原始文件名 |
| fileSize | INTEGER | | 文件大小 (bytes) |
| storagePath | TEXT | | 存储路径（本地或 s3: 前缀） |
| createdAt | INTEGER | | 上传时间 |

**mediaDeletions** — 媒体删除队列
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID |
| mediaId | TEXT | NOT NULL | 媒体 ID |
| storagePath | TEXT | NOT NULL | 存储路径 |
| requestedAt | INTEGER | | 请求删除时间 |
| completedAt | INTEGER | nullable | 实际删除时间（NULL=待处理） |

#### 推送通知

**pushNotifications** — 通知记录
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID |
| userId | TEXT | NOT NULL | 目标用户 |
| roomId | TEXT | NOT NULL | 来源房间 |
| eventId | TEXT | NOT NULL | 触发事件 |
| actions | TEXT (JSON) | | 推送动作 |
| read | INTEGER | DEFAULT 0 | 是否已读 |
| ts | INTEGER | | 时间戳 |

**pushRules** — 推送规则
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | ULID |
| userId | TEXT | FK→accounts | 用户 ID |
| kind | TEXT | | override/underride/sender/room/content |
| ruleId | TEXT | NOT NULL | 规则标识 |
| conditions | TEXT (JSON) | nullable | 条件列表 |
| actions | TEXT (JSON) | | 动作列表 |
| pattern | TEXT | nullable | 匹配模式 |
| isDefault | INTEGER | DEFAULT 0 | 是否默认规则 |
| enabled | INTEGER | DEFAULT 1 | 是否启用 |
| priority | INTEGER | DEFAULT 0 | 优先级 |

#### 临时数据

**readReceipts** — 已读回执
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| roomId | TEXT | PK | 房间 ID |
| userId | TEXT | PK | 用户 ID |
| eventId | TEXT | NOT NULL | 已读到的事件 |
| receiptType | TEXT | PK | m.read/m.read.private/m.fully_read |
| ts | INTEGER | | 时间戳 |

**typingNotifications** — 输入状态
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| roomId | TEXT | PK | 房间 ID |
| userId | TEXT | PK | 用户 ID |
| expiresAt | INTEGER | | 过期时间 |

**presence** — 在线状态
| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| userId | TEXT | PK, FK→accounts | 用户 ID |
| state | TEXT | DEFAULT 'offline' | online/unavailable/offline |
| statusMsg | TEXT | nullable | 状态消息 |
| lastActiveAt | INTEGER | | 最后活跃时间 |

---

## 3. 索引分析

### 3.1 现有索引

| 表 | 索引 | 列 |
|----|------|----|
| eventsState | idx_events_state_room | (roomId, id) |
| eventsTimeline | idx_events_timeline_room | (roomId, id) |
| eventsAttachments | idx_attachments_event | (eventId) |
| eventsAttachments | idx_attachments_media | (mediaId) |

### 3.2 缺失索引（建议添加）

| 表 | 建议索引 | 用途 | 优先级 |
|----|---------|------|--------|
| **oauthTokens** | (type, accountId) | 按类型和用户查询 token | 高 |
| **oauthTokens** | (expiresAt) | 过期清理 cron | 高 |
| **oauthTokens** | (grantId) | 按 Grant 吊销关联 token | 高 |
| **e2eeToDeviceMessages** | (userId, deviceId) | 接收者查询 | 高 |
| **e2eeOneTimeKeys** | (userId, deviceId, claimed) | OTK 认领 | 高 |
| **e2eeDeviceListChanges** | (userId) | 用户设备变更查询 | 中 |
| **media** | (userId) | 用户配额统计 | 中 |
| **mediaDeletions** | (completedAt) | 待处理删除查询 | 中 |
| **pushNotifications** | (userId, read) | 未读通知查询 | 中 |
| **pushNotifications** | (roomId, userId) | 房间内通知查询 | 低 |
| **accountTokens** | (userId) | 用户 token 列表 | 低 |
| **roomMembers** | (userId, membership) | 用户房间列表 | 中 |

### 3.3 索引添加的预估影响

以 1000 用户、100 房间、100 万消息的规模估算：

- **oauthTokens 索引**: 认证中间件查询从全表扫描 → 索引定位，每请求节省约 1-5ms
- **e2eeToDeviceMessages 索引**: 同步查询从 O(n) → O(log n)，高 E2EE 负载下节省 10-50ms
- **roomMembers (userId, membership) 索引**: joined_rooms 查询从全表扫描 → 索引定位

---

## 4. 外键约束分析

### 4.1 已有外键

| 子表 | 列 | 父表 |
|------|---|------|
| accountData.userId | → | accounts.id |
| accountFilters.userId | → | accounts.id |
| roomMembers.roomId | → | rooms.id |
| roomMembers.userId | → | accounts.id |
| roomAliases.roomId | → | rooms.id |
| currentRoomState.roomId | → | rooms.id |
| currentRoomState.eventId | → | eventsState.id |
| e2eeDehydratedDevices.userId | → | accounts.id |
| pushRules.userId | → | accounts.id |
| presence.userId | → | accounts.id |
| devices.userId | → | accounts.id |

### 4.2 缺失外键（建议评估）

| 子表 | 列 | 应参考 | 风险 | 建议 |
|------|---|-------|------|------|
| accountTokens.userId | → | accounts.id | 用户删除后孤儿 token | **添加 FK** |
| rooms.creatorId | → | accounts.id | 低风险（创建者信息仅展示） | 可选 |
| e2eeDeviceKeys.(userId,deviceId) | → | devices.(userId,id) | cron 已处理清理 | 可选（有 cron 兜底） |
| e2eeOneTimeKeys | → | devices | cron 已处理清理 | 可选 |
| e2eeToDeviceMessages | → | devices | cron 已处理清理 | 可选 |
| media.userId | → | accounts.id | 用户删除后孤儿文件 | **添加 FK** |
| oauthTokens.accountId | → | accounts.id | 用户删除后孤儿 token | **添加 FK** |
| pushNotifications.userId | → | accounts.id | 用户删除后孤儿通知 | 可选 |

> **设计权衡：** E2EE 相关表故意不加 FK，因为 cron 任务已处理孤儿清理，且 FK 约束会增加写入开销。但 accountTokens、media、oauthTokens 应该添加 FK 以保证数据一致性。

---

## 5. 查询模式分析

### 5.1 热点查询

| 查询场景 | 当前实现 | 问题 | 优化建议 |
|---------|---------|------|---------|
| 认证验证 | `SELECT FROM oauthTokens WHERE id = "AccessToken:{token}"` | 每请求执行，无索引 | id 是 PK，已优化 |
| 房间事件查询 | 分别查两张表再内存合并排序 | 大房间时内存消耗高 | 使用 UNION ALL + LIMIT |
| 事件关系聚合 | 每个事件单独查 replace 关系 | N+1 问题 | 批量查询 or JOIN |
| 同步增量查询 | 每个房间独立查询 timeline + state | 房间多时查询次数爆炸 | 批量查询优化 |
| 未读计数 | 每个房间 COUNT(*) + 已读回执比较 | N+1 问题 | 使用缓存或物化计数 |
| 房间成员查询 | 每个成员查 eventsState 获取事件详情 | N+1 问题 | JOIN 优化 |
| 用户配额检查 | `SUM(fileSize) FROM media WHERE userId = ?` | 每次上传全表扫描 | 添加 userId 索引 |
| 室友在线状态 | 嵌套循环：用户房间→房间成员→成员状态 | 三层 N+1 | 使用 JOIN + IN 子查询 |

### 5.2 写入模式

| 写入场景 | 频率 | 事务使用 | 问题 |
|---------|------|---------|------|
| 事件创建 | 高频 | 有事务 | 正确 |
| 设备更新 (lastSeenAt) | 极高频（每请求） | 无事务 | 写入放大 |
| Token 查询 + 更新 | 高频 | 无事务 | 可接受 |
| 密钥上传 | 中频 | 有事务 | 正确 |
| 媒体上传 | 低频 | 无事务 | TOCTOU 竞态 |

---

## 6. 数据迁移

### 6.1 当前方案

使用 Drizzle Kit 管理迁移：

```bash
bun run db:generate   # 根据 schema.ts 生成迁移 SQL
bun run db:migrate    # 执行迁移
bun run db:push       # 直接同步 schema（开发用，跳过迁移文件）
```

迁移文件存储在 `drizzle/` 目录。

### 6.2 建议改进

1. **添加迁移版本检查**：服务启动时验证数据库版本与代码版本一致
2. **数据备份钩子**：迁移前自动备份 SQLite 文件
3. **回滚机制**：当前仅有前进迁移，无回滚脚本

---

## 7. 改进方向总结

### 高优先级

1. **添加缺失索引** — 特别是 oauthTokens、e2eeToDeviceMessages、roomMembers
2. **添加关键外键** — accountTokens、media、oauthTokens
3. **修复 N+1 查询** — eventQueries 内存合并 → SQL UNION、formatEventWithRelations 批量化
4. **减少设备写入放大** — auth middleware 每请求更新 lastSeenAt，改为间隔更新

### 中优先级

5. **事件查询优化** — 使用 SQL UNION ALL 替代双表查询+内存合并
6. **未读计数物化** — 缓存 notification_count 避免每次同步全量计算
7. **配额检查原子化** — 使用事务避免 TOCTOU 竞态

### 低优先级

8. **考虑表分区** — 大规模部署时按房间 ID 分区事件表
9. **归档机制** — 冷数据迁移到归档表减少热表体积
10. **只读副本** — SQLite 的 WAL 模式支持只读连接，可用于分离读写负载
