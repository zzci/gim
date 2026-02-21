# gim

Matrix 协议服务端实现，基于 Hono + Bun + Drizzle ORM + SQLite 构建。

支持 Matrix Client-Server API，包括 E2EE (Olm/Megolm)、Sync (long-poll)、SSO 认证、媒体存储和管理面板。

## 快速开始

### 本地开发

```bash
bun install
cp .env.example .env        # 配置环境变量
bun run db:push              # 初始化数据库
bun run dev                  # 启动开发服务器 (localhost:3000)
```

### Docker 部署

#### 使用 Docker Compose（推荐）

1. 复制并编辑环境变量：

```bash
cp .env.example .env
```

编辑 `.env`，至少设置以下变量：

```env
IM_SERVER_NAME=your-domain.com
IM_COOKIE_SECRET=your-secure-random-string
IM_OIDC_CLIENT_ID=your-oidc-client-id
IM_OIDC_CLIENT_SECRET=your-oidc-client-secret
```

2. 启动服务：

```bash
docker compose up -d
```

服务将在 `http://localhost:3000` 启动，数据持久化在 Docker volume `gim-data` 中。

3. 查看日志：

```bash
docker compose logs -f gim
```

4. 停止服务：

```bash
docker compose down
```

#### 单独使用 Docker

构建镜像：

```bash
docker build -t gim .
```

运行容器：

```bash
docker run -d \
  --name gim \
  -p 3000:3000 \
  -v gim-data:/app/data \
  -e NODE_ENV=production \
  -e IM_SERVER_NAME=your-domain.com \
  -e IM_COOKIE_SECRET=your-secure-random-string \
  -e IM_OIDC_ISSUER=https://login.gid.io/oidc \
  -e IM_OIDC_CLIENT_ID=your-oidc-client-id \
  -e IM_OIDC_CLIENT_SECRET=your-oidc-client-secret \
  -e DB_PATH=/app/data/gim.db \
  gim
```

#### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `IM_SERVER_NAME` | `localhost` | Matrix 服务器域名 |
| `IM_COOKIE_SECRET` | - | Cookie 签名密钥（生产环境必填） |
| `IM_OIDC_ISSUER` | `https://login.gid.io/oidc` | 上游 OIDC 提供者 |
| `IM_OIDC_CLIENT_ID` | - | OIDC 客户端 ID |
| `IM_OIDC_CLIENT_SECRET` | - | OIDC 客户端密钥 |
| `DB_PATH` | `data/gim.db` | SQLite 数据库路径 |
| `IM_CACHE_DRIVER` | `memory` | 缓存驱动：`memory` 或 `redis` |
| `REDIS_URL` | `redis://localhost:6379` | Redis 地址（缓存驱动为 redis 时需要） |
| `IM_LOG_FORMAT` | `cli` / `json` | 日志格式（dev: cli, prod: json） |
| `IM_LOG_LEVEL` | `debug` / `info` | 日志级别（dev: debug, prod: info） |

完整环境变量列表见 [`.env.example`](.env.example)。

#### 数据持久化

容器内数据存储在 `/app/data` 目录，包括 SQLite 数据库和本地媒体文件。使用 Docker volume 挂载以确保数据持久化：

```bash
# Docker Compose 默认使用命名卷 gim-data
# 也可以挂载宿主机目录：
docker run -v /path/on/host:/app/data ...
```

#### 健康检查

Docker Compose 配置中已包含健康检查，访问 `/health/ready` 端点：

```bash
curl http://localhost:3000/health/ready
```

## 管理面板

管理面板是独立的 SPA，生产构建时自动打包到镜像中，访问 `/admin/` 路径。

授予用户管理员权限：

```bash
bun run admin:create @user:your-domain.com
```

## 文档

详细文档见 [`docs/`](docs/) 目录：

- [架构概览](docs/architecture.md)
- [数据库设计](docs/database.md)
- [开发指南](docs/development-guide.md)
- [扩展性分析](docs/extensibility.md)
- [安全分析](docs/security.md)
- [改进路线图](docs/roadmap.md)

## 许可证

Private
