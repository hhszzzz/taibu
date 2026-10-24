# TaiBu MCP Server 使用手册

本文档对应 MCP `2026-07-28`（北京时间 2026-07-29 发布）和官方 TypeScript SDK v2。

TaiBu 提供两种 MCP 入口：

- 公共 HTTP Server：`https://mcp.mingai.fun/mcp`
- 本地 stdio 包：`taibu-mcp`

两种入口复用 `taibu-core` 中同一套工具 manifest、算法、输入输出 schema、规范文本和 canonical JSON，不维护两份术数实现；解读用的方法卡（见第 5 节）也来自 `taibu-core`。

## 1. 客户端配置

### 1.1 公共 HTTP Server

推荐直接导入：

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

公共服务不要求 OAuth、API Key、站点账号或自定义请求 Header。客户端会自动完成协议发现和请求封装。

客户端不能在本地按需加载工具时，可把地址换成 `https://mcp.mingai.fun/mcp/core`，只列出排盘工具（见第 6 节）。

### 1.2 本地 stdio

```json
{
  "mcpServers": {
    "taibu": {
      "command": "npx",
      "args": ["-y", "taibu-mcp"]
    }
  }
}
```

要求本机安装 Node.js 20 或更高版本。需要只列排盘工具时，在该配置中加入 `"env": { "TAIBU_MCP_TOOLS": "core" }`（见第 6 节）。

## 2. 2026-07-28 协议行为

新版协议取消初始化会话，主要变化如下：

- 客户端通过 `server/discover` 获取服务端版本、能力和使用说明。
- 每个请求都在 `params._meta` 中声明协议版本、客户端能力和可选客户端信息。
- HTTP 请求使用 `POST /mcp`，不再通过 GET/DELETE 管理 MCP 会话。
- HTTP 层校验 `MCP-Protocol-Version` 与 `Mcp-Method`；`tools/call` 与 `prompts/get` 还校验 `Mcp-Name`。
- 成功结果包含 `resultType: "complete"`。
- `server/discover`、`tools/list` 和 `prompts/list` 包含 `ttlMs`、`cacheScope` 缓存提示。
- 长连接通知通过 POST `subscriptions/listen` 建立。

服务仍接受 2025 年协议的无状态 POST 请求：旧客户端可以继续调用 `initialize`、`tools/list` 和 `tools/call`，但服务不再签发或读取 `Mcp-Session-Id`，也不提供旧式 GET SSE 或 DELETE 会话流程。

## 3. 协议示例

正常 MCP 客户端会自动生成以下内容。只有调试协议时才需要手工发送。

### 3.1 服务发现

```bash
curl -X POST https://mcp.mingai.fun/mcp \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "server/discover",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          "name": "example-client",
          "version": "1.0.0"
        },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

服务会返回：

- `supportedVersions: ["2026-07-28"]`
- `capabilities.tools`、`capabilities.prompts`
- `instructions`（提示模型解读前先加载方法卡；`/mcp/core` 另说明低频工具的查找方式）
- `resultType: "complete"`
- 公共缓存提示
- `_meta["io.modelcontextprotocol/serverInfo"]`

### 3.2 列出工具

```bash
curl -X POST https://mcp.mingai.fun/mcp \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/list' \
  --data '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

每个工具包含稳定的 `name`、中文 `title`、`description`、`inputSchema`、`outputSchema` 和安全注解。工具 title 默认从描述中 ` - ` 前的中文名称生成，避免在多处重复维护。

### 3.3 调用工具

```bash
curl -X POST https://mcp.mingai.fun/mcp \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' \
  -H 'Mcp-Name: xiaoliuren' \
  --data '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      },
      "name": "xiaoliuren",
      "arguments": {
        "lunarMonth": 1,
        "lunarDay": 1,
        "hour": 1,
        "question": "今日事项是否顺利"
      }
    }
  }'
```

工具成功结果包含：

- `resultType: "complete"`
- `content[0].text`：适合人类或模型直接阅读的规范文本
- `structuredContent`：符合工具 `outputSchema` 的 canonical JSON
- `_meta["io.modelcontextprotocol/serverInfo"]`：服务端身份

工具参数或业务执行错误通过 `isError: true` 返回，让模型能够读取错误并修正调用；协议格式错误则使用 JSON-RPC error。

## 4. 可用工具

| 工具 | Title | 功能 |
| --- | --- | --- |
| `astrology` | 西方占星命盘 | 本命盘与流运盘 |
| `bazi` | 八字命盘 | 四柱、十神、藏干、神煞与关系格局 |
| `bazi_pillars_resolve` | 四柱反推 | 由四柱反推出生时间候选 |
| `ziwei` | 紫微斗数命盘 | 十二宫、星曜、四化与大限 |
| `ziwei_horoscope` | 紫微斗数运限 | 大限、小限、流年、流月、流日、流时 |
| `ziwei_flying_star` | 紫微斗数飞星 | 四化飞布、自化与宫位关系 |
| `liuyao` | 六爻排卦 | 卦象、爻位、用神、关系与时机 |
| `meihua` | 梅花易数起卦 | 时间、字占、物数与报数起卦 |
| `tarot` | 塔罗抽牌 | 多种牌阵抽牌 |
| `taiyi` | 太乙九星观测 | 时空底盘、九星与核心关系 |
| `almanac` | 黄历查询 | 宜忌、冲煞、值星、方位与时辰吉凶 |
| `bazi_dayun` | 八字大运 | 起运、大运、小运与流年链路 |
| `bazi_relations` | 八字岁运刑冲合害 | 岁运叠加到原局后的干支关系、岁运提示与太岁（原局之间的关系见命盘，须给出年份、流日或大运）；可按柱位、类型筛选 |
| `bazi_wuxing` | 八字五行旺衰 | 月令旺衰与藏干透出、四干通根与无根、干支自坐、相邻天干生克、缺失五行；只列事实，不判身强身弱；可只取部分事实组 |
| `bazi_liunian_scan` | 八字流年扫描 | 逐年干支、所在大运、与原局和大运的关系与太岁；可按柱位、类型筛选 |
| `ziwei_palace` | 紫微宫位详查 | 单宫星曜四化、三方四正、夹宫、宫干飞化与运限叠加 |
| `liuyao_line` | 六爻逐爻详查 | 单爻纳甲、六亲、世应、旺衰、空亡、回头生克与变爻 |
| `almanac_select` | 黄历择日筛选 | 日期区间的候选日、事项宜忌过滤与冲煞排除 |
| `astrology_point` | 占星单点详查 | 单星体或宫位的落座、传统尊贵、相位与流运触发；可只看本命或流运 |
| `qimen_palace` | 奇门宫位详查 | 单宫天地盘、星门神、状态、旺衰、生克与格局 |
| `daliuren_lessons` | 大六壬课传详查 | 四课三传、神将生克、日干寄宫与类神定位；可只看课、传或类神 |
| `qimen` | 奇门遁甲排盘 | 九宫、九星、八门、八神与格局 |
| `daliuren` | 大六壬排盘 | 天地盘、四课、三传、神将与课体 |
| `xiaoliuren` | 小六壬占测 | 起课信息、推演链与落宫结果 |

工具的完整参数与输出结构以运行时 `tools/list` 为准。此外两种入口都提供 `load_analysis_method`（加载方法卡，见第 5 节）；精简列表另有 `tool_search`、`tool_call`（见第 6 节）。

8 个详查工具（`bazi_relations`、`bazi_wuxing`、`bazi_liunian_scan`、`ziwei_palace`、`liuyao_line`、`astrology_point`、`qimen_palace`、`daliuren_lessons`）默认文本只列所查事实；传 `detailLevel: "full"` 另附判定口径；`structuredContent` 始终带口径与计算规则，计算规则不写进文本。只问某柱、某类关系或某几组事实时，用 `pillars`、`types`、`sections`、`focus` 等筛选参数只取所需；八字关系类筛选另列「同字牵连」（与所列关系共用同一字，须一并看），并以「未列出」给出筛掉的条数。筛选参数写错时返回 `isError: true`，错误信息写明缺少或应改用的参数。

## 5. 方法卡

太卜的解读方法写成 13 张方法卡：每个体系一张默认卡（子平八字、紫微斗数、六爻、梅花易数、奇门遁甲、大六壬、小六壬、太乙神数、塔罗、西方占星、黄历择日），另有流派卡「盲派八字」（`bazi-mangpai`）与不需排盘的「周公解梦」（`dream`）。每张卡给出角色、断法、工具流程与输出要求，并附解读通则与工具约定。与太卜站内 Agent、普通对话及 skill 使用同一份来源。

- 工具 `load_analysis_method`：模型自己加载方法卡。`id` 填方法卡 ID，或填刚调用的工具名（得到该体系的默认卡）；同一体系有多张卡时按用户点名的流派选。未知 ID 返回 `isError: true`。
- prompts：每张卡一个同名 prompt，可选参数 `question`（要问的事或要解的梦）。`prompts/get` 返回一条用户消息：方法卡全文、解读通则、工具约定与问题；未给问题时请模型先询问。按协议，prompts 由用户选用（客户端通常显示为斜杠命令），模型自己取方法卡用上面的工具。

## 6. 按需加载的工具

MCP 没有「延迟提供」的工具：`tools/list` 列出服务当前提供的全部工具，协议要求它不随连接或其他请求变化，因此不能像站内 Agent 那样「搜索后再加入列表」。Claude Code 等客户端会在本地按需加载 MCP 工具（工具搜索）；不支持的客户端会把全部工具说明放进模型上下文。为此服务提供固定的精简列表：

| 入口 | 列出的工具 |
| --- | --- |
| HTTP `POST /mcp`；stdio 默认（`TAIBU_MCP_TOOLS=all`） | 全部 24 个计算工具与 `load_analysis_method` |
| HTTP `POST /mcp/core`；stdio `TAIBU_MCP_TOOLS=core` | 11 个排盘工具、`load_analysis_method`、`tool_search`、`tool_call` |

精简列表中其余 13 个低频工具（8 个详查与 `bazi_dayun`、`bazi_pillars_resolve`、`ziwei_horoscope`、`ziwei_flying_star`、`almanac_select`）经两步使用：`tool_search` 按中文关键词或工具名查找（如「大运」「流年扫描」「飞星四化」「择日」「宫位」「动爻」），返回各工具的完整说明与参数 schema；`tool_call` 以 `{ "name": 工具名, "arguments": 参数 }` 调用，结果（规范文本、canonical JSON、地点解析与随机种子作用域）与直接调用相同。已列出的工具不经 `tool_call`。给模型看的工具说明（名称、描述与参数 schema）约由 6.4 万字符降到 2.7 万字符。stdio 的 `TAIBU_MCP_TOOLS` 取其他值时服务拒绝启动并说明原因；HTTP 按入口决定列表，客户端请求头无法改变。

## 7. 地点解析

公共 HTTP Server 可以通过 `AMAP_WEB_SERVICE_KEY` 启用出生地点解析，用于：

- `astrology`：补全经纬度
- `bazi`、`ziwei`、`ziwei_horoscope`、`ziwei_flying_star`：补全真太阳时所需经度
- 详查工具（如 `bazi_relations`）沿用其基础工具的解析口径

未配置密钥、解析失败或精度不足时，工具仍按 core 的原始规则执行，并在文本及 `structuredContent.placeResolutionInfo` 中说明回退原因。

## 8. 自部署

### 8.1 Docker Compose

```bash
cp .env.example .env
docker compose --env-file .env -f docker-compose.mcp.yml up -d --build
```

默认端口为 `3001`：

- `GET /health`：健康检查
- `GET /info`：服务信息与当前协议版本
- `POST /mcp`：MCP 请求入口（全部工具）
- `POST /mcp/core`：只列排盘工具的入口

### 8.2 本地构建

```bash
pnpm install
pnpm -C packages/core build
pnpm -C packages/mcp-server build
pnpm -C packages/mcp-server start
```

## 9. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MCP_HOST` | `127.0.0.1` | 监听地址；容器内使用 `0.0.0.0` |
| `PORT` | `3001` | HTTP 端口 |
| `MCP_ALLOWED_ORIGINS` | 空 | 浏览器 Origin 白名单；无 Origin 的非浏览器客户端放行 |
| `MCP_ALLOWED_HOSTS` | 空 | 可选 Host 白名单 |
| `MCP_RATE_LIMIT_PER_MINUTE` | `120` | 单 IP、单 HTTP method 每分钟请求数 |
| `MCP_MAX_SUBSCRIPTIONS` | `1000` | 最大并发 `subscriptions/listen` 长连接数 |
| `MCP_MAX_SUBSCRIPTIONS_PER_IP` | `3` | 单 IP 最大订阅长连接数 |
| `MCP_TRUST_PROXY` | `false` | 位于受信反向代理后才设为 `true` |
| `MCP_REQUEST_LOG` | `false` | 输出匿名请求日志 |
| `AMAP_WEB_SERVICE_KEY` | 空 | 可选高德地点解析密钥 |

公共 MCP Server 不读取站点数据库、OAuth、JWT 或用户 API Key 配置。

## 10. 安全边界

线上服务保持匿名公开，但仍执行以下保护：

- Host 与 Origin 校验，降低 DNS rebinding 风险
- 1 MB JSON 请求体限制
- 按客户端 IP 和 HTTP method 限流
- `subscriptions/listen` 总量与单 IP 并发限制
- 线上工具内部错误隐藏具体异常文本
- `liuyao`、`tarot` 的随机种子作用域由服务端可信客户端 IP 生成，客户端请求头无法覆盖

如果启用 `MCP_TRUST_PROXY=true`，必须确保应用只接受来自受信反向代理的流量，否则转发 IP 头可能被伪造。

## 11. 兼容性与迁移

从 2025 年协议迁移时：

1. 优先升级 MCP 客户端，让客户端使用 `server/discover`。
2. 删除自行维护的 `Mcp-Session-Id`、初始化通知、GET SSE 与 DELETE 会话逻辑。
3. 不要手工拼装标准 Header；使用支持 `2026-07-28` 的 MCP SDK 或客户端。
4. 如暂时无法升级，继续使用无状态 POST 的 `initialize`、`tools/list`、`tools/call`。

HTTP 标准头与请求体不一致时返回 `-32020`；不支持的协议版本返回 `-32022`。

## 12. 验证

仓库级验证命令：

```bash
pnpm test
pnpm lint
pnpm build
```

测试覆盖现代 HTTP、旧版无状态 HTTP、现代/旧版 stdio、标准 Header 错误、协议版本错误、结构化结果、订阅并发限制、方法卡 prompts 与工具，以及精简列表的查找、调用与入口隔离。

## 13. 参考

- [MCP 2026-07-28 Specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [公共 Server 运行说明](../../packages/mcp-server/README.md)
- [本地 stdio 运行说明](../../packages/mcp/README.md)
