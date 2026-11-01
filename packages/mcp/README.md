# taibu-mcp

TaiBu 的本地 `stdio` MCP Server，适合直接接入 Claude Desktop、Cursor、Cherry Studio 等支持 MCP 的客户端。

当前实现基于 MCP `2026-07-28` 与官方 TypeScript SDK v2，同时保留 2025 年协议的 `initialize` 兼容流程。新版客户端使用 `server/discover`，无需协议会话。

## 快速开始

在 MCP 客户端配置中加入：

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

要求：

- 本机已安装 [Node.js](https://nodejs.org/)
- 客户端支持 MCP `stdio` 连接方式

如需从 GitHub Packages 安装镜像包，请改用 `@hhszzzz/taibu-mcp`，并把 `@hhszzzz` scope 指向 `https://npm.pkg.github.com`。npmjs 主包名仍然是 `taibu-mcp`。

## 可用工具

| 工具 | 说明 |
|------|------|
| `bazi` | 八字排盘 |
| `bazi_pillars_resolve` | 四柱反推 |
| `bazi_dayun` | 大运、小运、流年链路 |
| `bazi_relations` | 八字岁运刑冲合害详查 |
| `bazi_wuxing` | 八字五行旺衰详查 |
| `bazi_liunian_scan` | 八字流年扫描 |
| `bazi_hepan` | 八字合盘 |
| `bazi_hour_candidates` | 推算出生时辰 |
| `ziwei` | 紫微斗数排盘 |
| `ziwei_horoscope` | 紫微运限 |
| `ziwei_flying_star` | 紫微飞星 |
| `ziwei_palace` | 紫微宫位详查 |
| `liuyao` | 六爻排卦分析 |
| `liuyao_line` | 六爻逐爻详查 |
| `meihua` | 梅花易数起卦与断卦 |
| `tarot` | 塔罗抽牌 |
| `almanac` | 黄历查询 |
| `almanac_select` | 黄历择日筛选 |
| `astrology` | 西方占星命盘与流运 |
| `astrology_point` | 占星单点详查 |
| `qimen` | 奇门遁甲排盘 |
| `qimen_palace` | 奇门宫位详查 |
| `taiyi` | 太乙九星观测 |
| `daliuren` | 大六壬排盘 |
| `daliuren_lessons` | 大六壬课传详查 |
| `xiaoliuren` | 小六壬占测 |

## 方法

除计算工具外，服务还提供太卜的 15 个方法：每个体系一个默认方法（断法、工具流程与输出要求），另有流派方法「盲派八字」、不需排盘的「周公解梦」，以及与体系方法同用的技法「推理时柱」（`birth-hour`）与「验证前事」（`past-events`）。

- 工具 `load_analysis_method`：模型自己加载方法，`id` 填方法 ID，或填刚调用的工具名（得到该体系的默认方法）。服务说明（`instructions`）提示模型解读前先加载。
- prompts：每个方法一个同名 prompt（如 `bazi`、`bazi-mangpai`、`dream`），可选参数 `question`。支持 prompts 的客户端可以把它们当作斜杠命令选用。

## 按需加载的工具

MCP 没有「延迟提供」的工具：`tools/list` 一次列出全部工具，且不能因其他请求而改变。Claude Code 等客户端会在本地按需加载（工具搜索）；不支持的客户端会把全部工具说明放进模型上下文。此时可以设 `TAIBU_MCP_TOOLS=core`：

```json
{
  "mcpServers": {
    "taibu": {
      "command": "npx",
      "args": ["-y", "taibu-mcp"],
      "env": { "TAIBU_MCP_TOOLS": "core" }
    }
  }
}
```

`core` 只列出 11 个排盘工具与 `load_analysis_method`，另加 `tool_search`（按中文关键词查找其余 15 个低频工具，返回用途与参数 schema）和 `tool_call`（按名称调用这些工具，结果与直接调用相同）；给模型看的工具说明约减少六成。默认值 `all` 列出全部工具；其他取值会让服务启动失败并说明原因。

## 返回结构

本地 `taibu-mcp` 的工具结果统一分成两条通道：

- `content[0].text`
  - 始终返回 canonical text，适合人类直接阅读或交给 AI 继续消费
- `structuredContent`
  - 当工具声明了 `outputSchema` 时返回 canonical JSON，字段结构与 `outputSchema` 对齐，适合程序消费

如果你要稳定的结构化结果，请始终读取 `structuredContent`。

在 MCP `2026-07-28` 客户端中，成功结果还会包含 `resultType: "complete"`；`server/discover`、`tools/list` 与 `prompts/list` 提供公共缓存提示。旧协议客户端维持原有结果形状。

## 其他安装方式

```bash
npm install -g taibu-mcp
```

全局安装后也可以在 MCP 客户端中改成：

```json
{
  "mcpServers": {
    "taibu": {
      "command": "taibu-mcp"
    }
  }
}
```

## 本地开发

```bash
pnpm install
pnpm -C packages/core build
pnpm -C packages/mcp build
node packages/mcp/dist/index.js
```

## 相关包

- [`taibu-core`](https://www.npmjs.com/package/taibu-core): 共享算法、工具定义与 transport 适配器

## License

`taibu-mcp` 使用 `MIT` 许可证，详见当前目录下的 `LICENSE` 文件。

## 版本批次

| 版本 | 批次说明 |
|------|----------|
| `4.0.0` | 随 `taibu-core` 4.0.0 发布：26 个工具（新增 8 个详查工具与 `almanac_select`、`bazi_hepan`、`bazi_hour_candidates`）、15 个方法（`load_analysis_method` 与同名 prompt）、`TAIBU_MCP_TOOLS=core` 精简列表；工具文本只写新事实，计算规则只在 `structuredContent` |
| `3.6.0` | 随 `taibu-core` 3.6.0 发布：六爻反伏、应期类型与三合提示等输出补充 |
| `3.5.0` | 升级 MCP `2026-07-28` 与官方 TypeScript SDK v2，兼容旧版 stdio 初始化流程 |
| `3.4.1` | 修复 npm 包中 `taibu-core` 依赖误发为 `workspace:*`，恢复 `npx -y taibu-mcp` 可用性 |
| `3.4.0` | 新增 `astrology` 西方占星命盘与流运 |
| `3.3.0` | 新增 `taiyi` 太乙九星观测 |
| `3.2.0` | 新增 `xiaoliuren` 小六壬占测 |
| `3.1.0` | 新增 `meihua` 梅花易数起卦与断卦 |
| `3.0.0` | 重构包结构，优化输出与函数暴露接口 |
| `2.0.0` | 规范输出结构：`content` 输出规范文本，`structuredContent` 输出 JSON |
| `1.5.0` | 同步导出、共享、结构化输出策略与在线服务对齐 |
| `1.4.0` | 新增 `daliuren` 大六壬 |
| `1.3.0` | 新增 `qimen` 奇门遁甲 |
| `1.2.6` | 补丁，集中修复输出契约、鉴权与运行时边界 |
| `1.2.5` | 旧基线版本，作为本次版本重排的对比起点 |
