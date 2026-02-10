# GIM 项目文档

> Matrix 协议服务端实现 | 版本 0.1.0-beta.1

## 文档索引

| 文档 | 内容 | 读者 |
|------|------|------|
| [架构概览](./architecture.md) | 系统架构、模块设计、请求流程、同步机制、E2EE 架构 | 所有开发者 |
| [数据库设计](./database.md) | 表结构、索引分析、外键约束、查询模式、迁移方案 | 后端开发者 |
| [扩展性分析](./extensibility.md) | 扩展性瓶颈、水平扩展路径、功能扩展指南、缓存策略、部署架构 | 架构师 |
| [开发指南](./development-guide.md) | 环境搭建、编码规范、模块开发模式、测试方法、环境变量 | 新加入开发者 |
| [改进路线图](./roadmap.md) | 问题清单、分阶段改进计划、技术债务、版本里程碑 | 项目管理/全体 |
| [安全分析](./security.md) | 认证安全、输入验证、E2EE 安全、限流、安全加固建议 | 安全审计/后端 |

## 快速开始

```bash
bun install
cp .env.example .env     # 配置环境变量
bun run db:push           # 初始化数据库
bun run dev               # 启动开发服务器 (localhost:3000)
```

详见 [开发指南](./development-guide.md)。
