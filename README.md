<div align="center">

<img src="public/favicon.svg" alt="太卜" width="80" height="80">

# 太卜

**将传统命理文化与AI深度融合**

[![Next.js](https://img.shields.io/badge/Next.js-16+-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)

Language: **中文** | [English](README.en.md)

[在线体验](https://www.mingai.fun) · [报告问题](https://github.com/hhszzzz/taibu/issues)

</div>

---

## 产品亮点

- **多命理体系** - 八字、六爻、紫微斗数、奇门遁甲、大六壬、梅花易数、塔罗、MBTI、面相、手相、合盘、周公解梦
- **AI智能分析** - 支持导出命理体系文本进行AI分析，多模型支持，深度推理，视觉识别
- **MCP Server** - 支持 Model Context Protocol（MCP），可在支持MCP的agent中直接调用命理工具
- **历史记录、知识库与@提及** - 支持存储所有命理体系的记录，可将命理体系纳入个人知识库，显式引用命理体系数据源
- **AI个性化** - 表达风格/用户画像/自定义指令 + 上下文、提示词预算可视化
- **多端体验** - Web + iOS/Android 客户端
- **社区与激励** - 命理记录、匿名讨论、签到激励

---

## 命理功能预览

| 功能模块 | 核心特性 |
| :----: | :--- |
| **八字排盘** | · 真太阳时、阳历农历排盘、即时排盘、四柱排盘<br/>· 五行天干地支、十神、藏干、星运、纳音、神煞（51种）、十二长生、刑害合冲<br/>· 天干五合、地支半合、地支三会<br/>· 大运、流年、流月、流日<br/>· 传统分析、盲派分析 |
| **紫微斗数** | · 十二宫位、三方四正<br/>· 主星、辅星、杂曜、四化（含自化）<br/>· 命主星/身主星、小限、博士十二星<br/>· 旺衰落陷、大限/流年/流月/流日/流时运限分析<br/>· 飞星分析（飞化落宫、三方四正） |
| **奇门遁甲** | · 九宫、天地盘、八门、九星、八神<br/>· 值符值使、遁甲类型、局数<br/>· 格局判定（吉/凶）、空亡、驿马、入墓、旺衰<br/>· 转盘排盘，拆补/茅山局法<br/>· 显式时区支持 |
| **大六壬** | · 天地盘、四课、三传<br/>· 天将（十二神将）、遁干<br/>· 49种神煞、课体分类<br/>· 十二长生、五行旺衰、建除十二神<br/>· 显式时区，支持本命/行年 |
| **六爻占卜** | · 硬币起卦、快速起卦、选卦起卦、时间起卦、数字起卦<br/>· 爻变明动、暗动<br/>· 卦辞、爻辞、象辞<br/>· 用神、原神、伏神、仇神<br/>· 空亡 · 世应、旺衰状态、刑冲合害<br/>· 互卦、错卦、综卦<br/>· 应期推测 |
| **梅花易数** | · 年月日時起卦、物数/声数、字占、丈尺尺寸、方位类象<br/>· 两数/三数报数扩展法<br/>· 本卦、互卦、变卦、错卦、综卦、动爻<br/>· 体卦/用卦、体用生克、月令旺衰、克应层次<br/>· 应期线索、定性吉凶判断 |
| **塔罗占卜** | · 9种牌阵：单牌、三牌阵、爱情牌阵、凯尔特十字、马蹄、抉择、身心灵、情境、是/否<br/>· 逆位判定、78张完整牌面解读、精美卡牌<br/>· 星座/元素对应、数字命理（人格牌/灵魂牌/年份牌）<br/>· 每日运势指引 |
| **关系合盘** | · 情侣、商业、亲子<br/>· 未来运势走线<br/>· 沟通建议 |
| **面相、手相** | · 天庭、鼻相、眼相、口相<br/>· 生命线、智慧线、事业线、感情线 |
| **运势中心** | · 基于命盘的每日、每月运势分析<br/>· 每日黄历（含方位系统、12时辰吉凶、二十八星宿）<br/>· 未来运势走线 |
| **MBTI性格测试** | · 90+道性格测试题<br/>· 综合AI分析性格 |
| **高度AI集成** | · 根据过往占卜综合分析<br/>· 命理体系全分析<br/>· 知识库、附件、搜索<br/>· 支持AI对话时提及所有命理体系<br/>· 年度命理报告 |

---

## MCP

太卜提供已部署的公共 MCP Server，可在支持 MCP 的 agent 中直接调用全部命理工具。服务已升级到 MCP `2026-07-28`（北京时间 2026-07-29 发布），并兼容 2025 年协议的无状态客户端。

### 快速配置

在客户端中导入以下 Server 配置即可使用：

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

新版客户端会自动执行 `server/discover` 并生成每请求协议元数据，无需配置 OAuth、API Key 或会话 Header。如需完全离线的本地 stdio 模式，请参阅 [`packages/mcp/README.md`](packages/mcp/README.md)。

### 支持的工具

| 工具 | 功能 | 提问例子 |
| --- | --- | --- |
| `bazi` | 八字排盘（支持阳历/农历，51种神煞，天干五合，地支半合/三会，胎元/命宫） | "我是1990年5月15日15点生，请帮我排盘" |
| `bazi_pillars_resolve` | 八字反查（四柱 → 出生时间候选，1900-2100） | "我的八字是丙午庚寅丙辰癸巳，请帮我分析" |
| `bazi_dayun` | 八字大运计算（十年大运周期，流年详情，太岁标注，小运） | AI会自动分析你的八字调用计算 |
| `ziwei` | 紫微斗数排盘（含命主星/身主星，小限，博士12星，三方四正） | "我是农历1990年4月初八生，请排紫微盘" |
| `ziwei_horoscope` | 紫微运限（大限/小限/流年/流月/流日/流时，流年星曜） | "帮我看看2026年的紫微运限" |
| `ziwei_flying_star` | 紫微飞星分析（飞化/自化/四化落宫/三方四正） | "分析一下我命宫的飞星" |
| `liuyao` | 六爻占卜（支持起卦/自主选卦/时间起卦/数字起卦，含互卦/错卦/综卦） | "我想占卜今年的事业运，请帮我起卦分析" |
| `meihua` | 梅花易数（支持年月日時、物数/声数、字占、丈尺尺寸、方位类象、两数/三数报数） | "现在起一卦，用梅花易数看这次合作能不能成" |
| `tarot` | 塔罗抽牌（9种牌阵，78张完整牌面，独立逆位关键词，星座/元素对应） | "请为我抽一张塔罗牌，关于近期的爱情运势" |
| `almanac` | 黄历查询（含方位系统，12时辰吉凶，二十八星宿） | "今天的黄历怎么样？适合求婚吗？" |
| `astrology` | 西方占星命盘与流运（命盘三巨头、本命主星、重大流运触发） | "帮我看一下这段时间的占星流运重点" |
| `qimen` | 奇门遁甲排盘（九宫、八门、九星、八神、值符值使、显式时区） | "用奇门看一下今天谈合作是否顺利" |
| `taiyi` | 太乙九星观测（外部时空环境、九星阵列、能量交互） | "用太乙九星看一下这个项目推进情况" |
| `daliuren` | 大六壬排盘（四课三传、天地盘、神将、显式时区） | "用大六壬看一下这件事的结果" |
| `xiaoliuren` | 小六壬占测（起课结果、宫位落点、核心断事线索） | "用小六壬看一下今天出行顺不顺" |

### SDK

如果你想在自己的 Node.js 项目中直接调用计算引擎（无需 MCP 协议），可以使用核心库：

```bash
npm install taibu-core
```

详见 [taibu-core npm 页面](https://www.npmjs.com/package/taibu-core) 

---

## 快速开始

### Docker 部署

支持三种方式：

```bash
# 准备环境变量（首次）
cp .env.example .env

# 1) 一键部署：同时启动 Web + MCP
docker compose up -d --build

# 2) 仅部署 Web
docker compose -f docker-compose.web.yml up -d --build

# 3) 仅部署 MCP Server
docker compose -f docker-compose.mcp.yml up -d --build
```

默认端口：
- Web: `3000` （[http://localhost:3000](http://localhost:3000)）
- MCP: `3001`（[http://localhost:3001/mcp](http://localhost:3001/mcp)）

### 开发环境部署

环境要求：
- Node.js 18+
- pnpm (推荐) / npm / yarn

```bash
# 克隆项目
git clone git@github.com:hhszzzz/taibu.git
cd taibu

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入必要的 API Keys

# 启动开发服务器
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

---

## 开发文档

- [架构与迁移边界](docs/manual/Architecture.md)：模块职责、AI 生命周期与计费、数据回放、兼容例外及回滚条件。
- [Core 公开 API](packages/core/README.md) · [MCP 使用手册](docs/manual/MCP-Server-Manual.md)
- [重构与测试验收记录](docs/manual/Refactor-Acceptance.md)

```bash
pnpm test -- src/tests/chat-route.test.ts # 按文件运行，自动构建所需包
pnpm test                                # 默认单元、路由、协议与守卫
pnpm exec playwright install --only-shell chromium # 首次配置浏览器
pnpm verify                              # 一次包构建，完整验收（需本地 Docker）
```

`pnpm test:db`、`pnpm test:auth`、`pnpm test:browser` 可独立运行。`test:auth` 使用独立临时 Auth/PostgREST/PostgreSQL 栈，不读取生产配置或现有数据。无法下载 Chromium 且本机已有 Chrome 时，显式使用 `pnpm verify -- --chrome`；不跳过浏览器断言。CI 默认使用固定 Chromium，并强制执行 SQL、真实 Auth/REST 与浏览器层。

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 许可证

本仓库采用混合许可证：

- `packages/core`
- `packages/mcp`
- `packages/mcp-server`

以上三个包采用 `MIT` 许可证，详见各自目录下的 `LICENSE` 文件。

除上述三个包外，仓库其余 Web、服务端、部署与运行时代码采用 `AGPL-3.0-only`，详见仓库根目录 [LICENSE](LICENSE)。

提示：

- `AGPL-3.0-only` 不禁止商用，但要求修改后的网络服务在对外提供时履行相应源码开放义务
- `MIT` 包允许商用、再分发与二次开发，但需保留版权与许可声明

---

<div align="center">

**太卜** - 用AI解读命运，用科技传承文化

Made with ❤️ by [hhszzzz](https://github.com/hhszzzz)

</div>
