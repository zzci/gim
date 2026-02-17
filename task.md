# GIM 任务清单

> 更新日期: 2026-02-17

## 已完成任务

- [x] 修复 Notifications 事件查询（`$event_id` 归一化）
- [x] 修复 Threads (MSC3440) 中 `m.relates_to` JSON 路径解析
- [x] 修复 Sliding Sync 增量房间 timeline（包含 state + timeline）
- [x] 修复 AppService 测试引导（`examples/setup.ts` 自动 upsert `test-as`）
- [x] 增强 AppService 缓存回填（缓存 miss 时从 DB 动态加载）
- [x] 修复 To-Device 相关设备选择稳定性（`/devices` 按最近活跃排序）
- [x] E2EE `keys/upload` 增加非生产兼容模式（生产仍可严格校验）
- [x] 合并 PR #9 到 `main`
- [x] 更新 `docs/architecture.md`（包含 key backup 关闭策略）

## 未完成任务（待规划）

- [ ] Federation（Server-Server）协议实现
- [ ] 多进程同步通知总线（Notifier -> Redis Pub/Sub）
- [ ] 多进程限流统一状态（RateLimit -> Redis）
- [ ] PostgreSQL 迁移路径（schema + SQL 兼容 + 迁移工具）
- [ ] 运维工具（备份/恢复、导入导出、诊断）
- [ ] 安全加固（CSP/安全头、端点级限流、不活跃设备自动过期）
- [ ] E2EE 深度场景补强（验证流程、密钥轮换等）

## 关闭项（明确不做）

- [x] 服务端 Room Key Backup（`/room_keys/version*`）  
  说明: 架构策略为关闭，不提供服务端密钥备份能力，接口保持 `M_NOT_FOUND`。

