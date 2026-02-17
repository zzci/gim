# Matrix 协议实现复审（第二轮）

> 范围：以 Matrix Client-Server / Server Discovery 关键规范为基准，对当前实现做“协议一致性”与“安全性”复审，聚焦可立即落地的问题。

## P0（高优先级）

### 1. `/.well-known/matrix/server` 返回体严重偏离规范并泄露敏感信息

**现状**
- 当前实现返回 `ok`, `req`, `env`，把请求头和进程环境变量直接暴露给外部。 
- 这既不符合 Matrix Server Discovery 的规范格式，也存在明显信息泄露风险（密钥、内部网络信息、部署细节等）。

**协议预期**
- `/.well-known/matrix/server` 应返回类似：
  ```json
  { "m.server": "example.com:443" }
  ```

**风险**
- 协议层：客户端/联邦组件无法按标准发现 homeserver。
- 安全层：环境变量泄露可直接扩大攻击面。

**建议修复**
1. 将该接口改为只返回 `m.server` 字段。
2. 禁止返回 `process.env`、完整请求头等调试信息。
3. 为该接口添加契约测试（schema + 字段白名单）。

---

## P1（中高优先级）

### 2. `m.set_displayname` / `m.set_avatar_url` capability 与实际实现不一致

**现状**
- `/_matrix/client/v3/capabilities` 声明：
  - `m.set_displayname.enabled = false`
  - `m.set_avatar_url.enabled = false`
- 但服务端已实现并允许用户通过 `PUT /profile/:userId/displayname` 与 `PUT /profile/:userId/avatar_url` 更新资料（仅限制本人）。

**风险**
- 客户端会依据 capability 隐藏功能入口，导致“服务端支持但客户端不可用”的兼容性问题。
- 调试和排障成本上升。

**建议修复**
1. 若功能已稳定，capabilities 改为 `true`。
2. 若功能暂不对外，保持 `false`，同时在 profile PUT 路由侧返回 `M_FORBIDDEN` 并关闭能力。
3. 增加 capability 与路由行为的一致性测试（contract test）。

---

### 3. 关闭注册时返回 `401`，语义上更接近 `403`

**现状**
- 当前注册关闭逻辑返回：`errcode=M_FORBIDDEN`，但 HTTP 状态码是 `401`。

**协议/语义预期**
- `401` 通常用于“未认证/认证失败”；
- 注册关闭属于“已知请求但被策略拒绝”，更符合 `403`。

**风险**
- 部分 SDK 或网关中间件会把 `401` 当成“需要认证流程”，导致错误重试或错误提示。

**建议修复**
1. 将注册关闭的 HTTP 状态码调整为 `403`。
2. 保持 `M_FORBIDDEN` 以兼容 Matrix 错误语义。
3. 补测试覆盖状态码断言。

---

### 4. `/.well-known/matrix/client` 的 issuer/account 指向策略需与 Delegated OIDC 一致化

**现状**
- `org.matrix.msc2965.authentication` 中 `issuer` / `account` 当前固定指向本服务域名。
- 项目又支持上游 OIDC（`IM_OIDC_ISSUER`），存在“本地 provider 与上游 provider 共存”的配置路径。

**风险**
- 在委托 OIDC 部署场景，若 `.well-known` 元数据与实际认证链路不一致，客户端可能出现登录跳转异常、token 校验失败或账户入口错误。

**建议修复**
1. 明确单一模式：
   - **内置 OIDC**：issuer/account 指向本服务。
   - **委托 OIDC**：issuer/account 指向上游并与 metadata 对齐。
2. 将模式写入配置文档并增加启动时一致性校验。

---

## P2（中优先级）

### 5. `/versions` 与 unstable feature 声明建议做“可验证来源”

**现状**
- `/versions` 返回到 `v1.13`，并声明多项 unstable features。
- 目前缺少“声明 -> 路由/行为 -> 测试”三者自动校验。

**风险**
- 随版本演进容易出现“声明支持但行为不完整/退化”。

**建议修复**
1. 建立 feature manifest（单一数据源）。
2. 在 CI 增加自检：
   - 每个 capability/unstable feature 必须映射至少一个契约测试。

---

## 建议新增测试清单（可直接建 issue 子任务）

1. `well-known server` 返回体 schema 测试（仅允许 `m.server`）。
2. `capabilities` 与 profile PUT 行为一致性测试。
3. 注册关闭时状态码测试（403 + M_FORBIDDEN）。
4. OIDC 模式一致性测试（内置/委托两套配置）。
5. `/versions` 特性声明回归测试（声明与路由能力匹配）。

---

## 结论

本轮复审的首要修复是 **`/.well-known/matrix/server` 信息泄露 + 协议不兼容**。其次是 **capability 声明与实际行为不一致**，会直接影响客户端功能可用性。其余问题主要集中在协议语义一致性和可维护性治理，建议在同一迭代内完成。
