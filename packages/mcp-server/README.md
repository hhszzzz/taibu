# taibu-mcp-server

TaiBu 的公共在线 MCP Server，使用 MCP HTTP 传输，任何网络客户端都可以直接连接，不要求 OAuth、API Key 或数据库。

当前协议版本为 `2026-07-28`（北京时间 2026-07-29 发布），基于官方 TypeScript SDK v2。服务同时接受 2025 年协议的无状态 POST 请求，便于旧客户端平滑迁移。

## 功能

- 复用 `taibu-core` 的全部公开 MCP 工具，以及 13 张方法卡：模型用 `load_analysis_method` 加载，用户可选用同名 prompt
- 标准入口：`POST /mcp` 列出全部工具；`POST /mcp/core` 只列排盘工具，其余低频工具经 `tool_search`／`tool_call` 使用
- `content[0].text` 返回规范文本，`structuredContent` 返回 canonical JSON
- MCP `2026-07-28`：`server/discover`、每请求能力声明、标准 HTTP 头校验与 `subscriptions/listen`
- 2025 年客户端：保留 `initialize`、`tools/list`、`tools/call` 无状态 POST 兼容，不再签发 `Mcp-Session-Id`
- Host、Origin、请求体、IP 请求频率及订阅长连接容量保护
- 可选高德地点解析；未配置时保留 core 的原始地点处理行为

## 运行

```bash
pnpm install
pnpm -C packages/core build
pnpm -C packages/mcp-server build
pnpm -C packages/mcp-server start
```

默认监听 `127.0.0.1:3001`：

- `GET /health`
- `GET /info`
- `POST /mcp`
- `POST /mcp/core`

`/info` 的 `auth` 固定为 `none`。服务不会读取或验证 `Authorization`、`x-api-key`。

新版协议每个请求都携带 `_meta`，HTTP 层同时校验 `MCP-Protocol-Version`、`Mcp-Method`，`tools/call` 与 `prompts/get` 还会校验 `Mcp-Name`。常规 MCP 客户端会自动生成这些字段和请求头，无需手工配置。

两个入口的工具列表各自固定：协议要求 `tools/list` 不随连接或其他请求变化，所以「按需加载」由入口选择，而不是搜索后改变列表。客户端不能自行在本地按需加载工具时，用 `/mcp/core` 可让给模型看的工具说明减少约六成。

## 客户端配置

```json
{
  "mcpServers": {
    "taibu": {
      "type": "streamable-http",
      "url": "https://mcp.mingai.fun/mcp"
    }
  }
}
```

只要排盘工具、低频工具按需查找时，把 `url` 换成 `https://mcp.mingai.fun/mcp/core`。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MCP_HOST` | `127.0.0.1` | 监听地址；容器中使用 `0.0.0.0` |
| `PORT` | `3001` | 服务端口 |
| `MCP_ALLOWED_ORIGINS` | 空 | 浏览器 Origin 白名单；无 Origin 的 MCP 客户端正常放行 |
| `MCP_ALLOWED_HOSTS` | 空 | 可选 Host 白名单 |
| `MCP_MAX_SUBSCRIPTIONS` | `1000` | 最大并发 `subscriptions/listen` 长连接数 |
| `MCP_MAX_SUBSCRIPTIONS_PER_IP` | `3` | 单 IP 最大订阅长连接数 |
| `MCP_RATE_LIMIT_PER_MINUTE` | `120` | 单 IP、单 HTTP method 每分钟请求数 |
| `MCP_TRUST_PROXY` | `false` | 仅在服务位于受信反向代理后启用 |
| `MCP_REQUEST_LOG` | `false` | 输出匿名请求日志 |
| `AMAP_WEB_SERVICE_KEY` | 空 | 可选地点解析密钥 |

浏览器请求必须配置 `MCP_ALLOWED_ORIGINS`；生产环境应列出确切来源，不建议使用 `*`。这项校验是 DNS rebinding 防护，不是用户认证。

## Docker Compose

```bash
docker compose --env-file .env -f docker-compose.mcp.yml up -d --build
```

公共 MCP 容器不需要站点数据库、JWT 或站点账号变量。

## 包关系

- `taibu-core`：算法、工具 manifest、规范文本和 JSON
- `taibu-mcp`：本地 stdio MCP Server，支持新旧协议
- `taibu-mcp-server`：公共 HTTP MCP 运行时，主协议为 `2026-07-28`
