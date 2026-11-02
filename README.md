<div align="center">

<img src="public/favicon.svg" alt="太卜" width="80" height="80">

# 太卜

**开源、可自托管的 AI 命理术数平台**

排盘交给代码，解读交给 AI

[![Release](https://img.shields.io/github/v/release/hhszzzz/taibu?style=flat-square&label=release&color=b5651d)](https://github.com/hhszzzz/taibu/releases)
[![taibu-mcp](https://img.shields.io/npm/v/taibu-mcp?style=flat-square&label=taibu-mcp)](https://www.npmjs.com/package/taibu-mcp)
[![taibu-core](https://img.shields.io/npm/v/taibu-core?style=flat-square&label=taibu-core)](https://www.npmjs.com/package/taibu-core)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](docs/manual/Self-Hosting.md)

**中文** | [English](README.en.md)

[在线体验](https://mingai.fun) · [更新日志](CHANGELOG.md) · [自托管](docs/manual/Self-Hosting.md) · [MCP 手册](docs/manual/MCP-Server-Manual.md) · [报告问题](https://github.com/hhszzzz/taibu/issues)

</div>

---

## 简介

太卜把传统命理术数做成可以复现、可以核对的工具，再让 AI 在工具结果上做解读。

- **排盘由代码完成**：`taibu-core` 实现 11 个体系的历法与排盘规则，输出规范文本与 canonical JSON，口径写在 [ALGORITHM_RULES.md](packages/core/ALGORITHM_RULES.md)。模型不手算干支、卦象与星曜。
- **解读由 AI 完成**：普通对话、后台 Agent、协作成员与定时任务都使用同一组工具和 15 个解读方法。
- **工具对外开放**：同一套实现经 MCP、离线 Skill 与 npm 包提供给 Claude、Cursor、Cherry Studio 等任意 AI 客户端。
- **完全自托管**：Next.js + PostgreSQL + Redis 的 Docker Compose 栈，一个镜像同时运行 Web 与 worker。

当前版本 **v1.0.1**，首个正式版本是 v1.0.0，变更见 [更新日志](CHANGELOG.md)。

## 功能

### 占术与排盘

| 体系 | 主要能力 |
| :--: | :-- |
| **八字** | 真太阳时、公历农历与四柱反推；十神、藏干、纳音、神煞、十二长生、干支刑冲合害；大运、流年、流月、流日；合盘；不知时辰时排三柱，或由 Agent 列候选时辰推算 |
| **紫微斗数** | 十二宫、三方四正、主辅杂曜、四化与自化、命主身主、小限、博士十二星；大限至流时运限；飞星与宫位详查 |
| **六爻** | 硬币、时间、数字与选卦起卦；明动暗动、世应、六亲六神、旺衰空破、伏神；互卦、错卦、综卦；应期线索；逐爻详查 |
| **梅花易数** | 年月日时、物数声数、字占、丈尺与方位起卦；体用生克、月令旺衰、应期线索 |
| **奇门遁甲** | 转盘与飞盘，拆补、茅山与节气均分局法；九宫、八门、九星、八神、值符值使、格局；宫位详查 |
| **大六壬** | 天地盘、四课三传、十二天将、遁干、神煞与课体；本命行年；课传详查 |
| **小六壬 · 太乙** | 小六壬起课与宫位落点；太乙九星观测与传统七十二局 |
| **塔罗** | 78 张完整牌面与逆位，9 种牌阵与自定义牌阵，星座与元素对应、生命数字 |
| **西方占星** | 本命盘与流运、七种宫制、自定义相位容许度、恒星黄道；单点详查 |
| **黄历择日** | 每日宜忌、方位、十二时辰吉凶、二十八星宿；按事项与多人生肖冲煞筛选吉日 |
| **其他** | 关系合盘（情侣、事业、亲子）、MBTI、面相与手相照片解读、周公解梦、日运与月运、年度报告 |

结果页只负责排盘与展示，解读统一交给 AI 对话；对话里可以 @ 引用任意命盘和记录。

### AI 对话

- 多模型、思考等级、附件（PDF、Word、Excel）、知识库检索与联网搜索；平台模型按 token 实际用量计费，也可以填自己的 API Key（BYOK），不计费。
- 15 种内置图表与沙箱 HTML 可视化；引用回答片段继续追问；公开只读的对话分享链接。
- 表达风格、用户画像、自定义指令与长期记忆；上下文用量显示在输入框里。

### Agent

- **持久执行**：任务在后台 worker 中由 [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable) 运行，关掉页面、断网或重启服务都不丢进度。
- **工作区**：命盘随模型的查看自动显示、定位与高亮；排盘、详查、合盘与推算时辰的结果可以展开、固定与保存。
- **计划与代码模式**：先研究、经用户批准再执行；在沙箱中组合调用工具。低频工具按需加载，长对话可以 `/compact`。
- **协作**：分工汇总的协作成员与常驻的后台子分析，按体系专家、研究员、复核员或自定义角色分配工具、指令与模型。
- **扩展**：SKILL.md 技能、外部 MCP 连接器、经 Exa / Tavily 等 MCP 服务路由的联网搜索与读网页，外部工具调用前的确认策略可选。
- **定时任务、生图与测评**：定时把一轮任务追加到固定对话（内置「每日早报」）；文生图；运行遥测与多模型测评排行。

Agent 的完整行为与边界见 [Agent 手册](docs/manual/Agent.md)。

### 账户、计费与管理

- 邮箱密码、邮箱验证码、找回密码与 Linux.do 登录。
- 美元钱包与订阅：按 5 小时、天、周、月或整期发放额度，兑换码、管理员加款、余额购买套餐；配置商户参数后开启易支付（支付宝、微信）。
- 管理后台：公告、功能开关、计费、AI 服务（网关、模型、models.dev 目录补全）、Agent 扩展（MCP 服务、技能、角色、用户扩展权限）与日志中心（用量、Agent 任务、定时任务、部署日志）。
- 管理员在侧栏看到当前版本，新版本发布后可以一键更新。
- 社区、站内通知、记录与知识库；Web 适配桌面与手机，另有 Android / iOS 客户端（Capacitor）。

## MCP、Skill 与 SDK

`taibu-core` 提供 26 个工具：11 个排盘工具与 15 个低频工具（详查、大运、四柱反推、运限、飞星、择日、合盘、推算时辰）。另有 15 个解读方法：每个体系一个默认方法，加上流派方法「盲派八字」、不需排盘的「周公解梦」，以及技法「推理时柱」与「验证前事」。

### 公共 MCP Server

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

无需 OAuth、API Key 或会话 Header。服务实现 MCP `2026-07-28`，同时接受 2025 年协议的无状态请求。客户端不能自行按需加载工具时，把地址换成 `https://mcp.mingai.fun/mcp/core`：只列 11 个排盘工具，其余工具经 `tool_search` / `tool_call` 使用，给模型看的工具说明约减少六成。

### 本地 stdio

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

完全离线运行，只需要 Node.js。设 `"env": { "TAIBU_MCP_TOOLS": "core" }` 可得到与 `/mcp/core` 相同的精简列表，见 [taibu-mcp](packages/mcp/README.md)。

### Skill

[`skills/taibu-divination`](skills/taibu-divination/SKILL.md) 是自包含的 Agent Skill：计算引擎已打包，只要求 Node.js 18+。把整个目录复制到客户端的技能目录（如 Claude Code 的 `~/.claude/skills/`）即可，方法卡位于 `methods/`。

### SDK

```bash
npm install taibu-core
```

```ts
import { calculateBazi, toBaziText } from 'taibu-core/bazi';
import { executeTool, renderToolResult } from 'taibu-core/mcp';

const chart = calculateBazi({ gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 });
console.log(toBaziText(chart));

const result = await executeTool('qimen', { year: 2026, month: 3, day: 19, hour: 21, timezone: 'Asia/Shanghai' });
console.log(renderToolResult('qimen', result).content[0].text);
```

各领域子路径、输出契约与算法口径见 [taibu-core](packages/core/README.md)。

<details>
<summary><b>全部 26 个工具</b></summary>

| 工具 | 功能 | 提问例子 |
| --- | --- | --- |
| `bazi` | 八字排盘（公历/农历，神煞，天干五合，地支半合与三会，胎元与命宫；不知时辰时排三柱） | "我是 1990 年 5 月 15 日 15 点生，请帮我排盘" |
| `bazi_pillars_resolve` | 四柱反推出生时间候选（1900–2100） | "我的八字是丙午庚寅丙辰癸巳，可能是哪天出生？" |
| `bazi_dayun` | 大运、小运与流年（太岁标注） | "帮我看看接下来十年的大运" |
| `bazi_relations` | 岁运刑冲合害详查（大运、流年、流月、流日叠加到原局） | "我 2027 年流年和原局有哪些刑冲合害？" |
| `bazi_wuxing` | 五行旺衰详查（月令、通根、自坐、相邻生克、缺失五行；只列事实） | "看看我八字日主有没有根" |
| `bazi_liunian_scan` | 流年扫描（逐年干支、所在大运、与原局和大运的关系，至多 30 年） | "扫一下我 2026 到 2035 年的流年" |
| `bazi_hepan` | 八字合盘（两盘之间的干支关系、日主互见十神、年命纳音；只给事实不打分） | "我 1990 年 1 月 15 日 9 点生，她 1992 年 8 月 3 日 14 点生，我们合不合？" |
| `bazi_hour_candidates` | 推算出生时辰（当天各时辰的候选与区分事实，可带往事年份比对） | "我 1995 年 1 月 9 日出生，不知道几点，能帮我推一下时辰吗？" |
| `ziwei` | 紫微斗数排盘（命主身主、小限、博士十二星、三方四正） | "我是农历 1990 年四月初八生，请排紫微盘" |
| `ziwei_horoscope` | 紫微运限（大限至流时，流年星曜） | "帮我看看 2026 年的紫微运限" |
| `ziwei_flying_star` | 紫微飞星（飞化、自化、四化落宫） | "分析一下我命宫的飞星" |
| `ziwei_palace` | 紫微宫位详查（星曜四化、三方四正、夹宫、宫干飞化与运限叠加） | "看看我命宫的三方四正" |
| `liuyao` | 六爻起卦与分析（含互卦、错卦、综卦） | "我想占今年的事业运，请帮我起卦" |
| `liuyao_line` | 六爻逐爻详查（纳甲、旺衰、空亡、回头生克与变爻） | "六爻里官鬼那一爻的旺衰如何？" |
| `meihua` | 梅花易数（年月日时、物数声数、字占、丈尺、方位、报数） | "现在起一卦，看这次合作能不能成" |
| `tarot` | 塔罗抽牌（9 种牌阵，78 张牌面，逆位，星座与元素对应） | "请为我抽一张塔罗牌，看看近期的感情" |
| `almanac` | 黄历（方位、十二时辰吉凶、二十八星宿） | "今天的黄历怎么样？适合搬家吗？" |
| `almanac_select` | 择日（区间内按事项筛宜忌、避开多人生肖冲煞，至多 92 天） | "帮我挑下个月适合结婚的日子，我们属马和属鸡" |
| `astrology` | 西方占星命盘与流运（三巨头、本命主星、重大流运） | "帮我看一下这段时间的占星流运重点" |
| `astrology_point` | 占星单点详查（落座、传统尊贵、相位与流运触发） | "看看我的金星落在哪、和谁有相位" |
| `qimen` | 奇门遁甲排盘（九宫、八门、九星、八神、值符值使） | "用奇门看一下今天谈合作是否顺利" |
| `qimen_palace` | 奇门宫位详查（天地盘、星门神、旺衰、生克与格局） | "奇门里值符落哪一宫？" |
| `taiyi` | 太乙九星观测与七十二局 | "用太乙看一下这个项目的推进情况" |
| `daliuren` | 大六壬排盘（四课三传、天地盘、天将） | "用大六壬看一下这件事的结果" |
| `daliuren_lessons` | 大六壬课传详查（四课上下、三传递生递克、神将与类神） | "细看这课的三传和神将生克" |
| `xiaoliuren` | 小六壬占测 | "用小六壬看一下今天出行顺不顺" |

</details>

## 快速开始

### 本地运行

需要 Docker（含 Compose v2）、Node.js 24 与 pnpm 10。

```bash
git clone https://github.com/hhszzzz/taibu.git
cd taibu
pnpm install
pnpm local:update   # 首次：生成配置，构建镜像，启动 db、redis、web、worker、mailpit
```

浏览器打开 `http://127.0.0.1:3080`，注册邮件在 Mailpit（`http://127.0.0.1:8025`）里查看；实际端口以 `pnpm local:status` 为准。随机生成的密钥和端口保存在 `.taibu-local/taibu-v2/`，不要公开或提交。

```bash
pnpm local:up       # 复用已有镜像启动
pnpm local:status   # 端口与健康状态
pnpm local:logs     # 跟随日志（凭据已脱敏）
pnpm selfhost down --project taibu-v2   # 停止，保留数据卷
```

注册后把自己设为管理员，再在「设置 → AI 服务」添加网关与模型，步骤见 [自托管手册](docs/manual/Self-Hosting.md#设为管理员)。

### 生产部署

生产使用 `deploy/compose.base.yml` + `deploy/compose.prod.yml`，镜像由 CI 发布在 `ghcr.io/hhszzzz/taibu`，主机只拉取不构建：

```bash
# /opt/taibu/source 是仓库，/opt/taibu/env/ 保存 compose.env 与按容器拆分的私有配置
EDGE_MODE=host deploy/deploy.sh v1.0.1   # 宿主已有 Caddy / Nginx 时
deploy/deploy.sh v1.0.1                  # 由本栈的 Caddy 接管 80/443
```

脚本会先备份数据库，再执行数据库初始化与迁移，成功后滚动更新并检查健康，失败自动回退。环境变量以 [`.env.example`](.env.example) 为准，邮件、备份、计费与一键更新见 [自托管手册](docs/manual/Self-Hosting.md)，旧部署升级见 [升级说明](docs/UPGRADE.md)。

## 架构

```text
浏览器 / App ──► Caddy ──► web（Next.js：页面、API、SSE）
                              │
            ┌─────────────────┼──────────────────┐
            ▼                 ▼                  ▼
  PostgreSQL 17 + pgvector   Redis 8          文件卷
  业务数据 · RLS · 任务     限流 · 缓存 · BullMQ   附件 · 生成图片
            ▲                 ▲                  ▲
            └──────── worker（Agent、文档解析、邮件、定时与维护任务）

taibu-core ──► Web 与 Agent 进程内调用 · taibu-mcp（stdio）· taibu-mcp-server（HTTP）· Skill
```

| 组件 | 说明 |
| --- | --- |
| Web | Next.js 16 模块化单体（standalone），React 19、Tailwind CSS 4、Base UI |
| 认证 | Better Auth，独立的 `identity` schema 与连接角色 |
| 数据 | Kysely `ScopedDb`：每个事务设置角色与身份，PostgreSQL RLS 隔离用户数据 |
| 后台 | 同一镜像的 worker：Pi Durable 执行 Agent，BullMQ 处理定时、邮件与维护任务 |
| 数据库定义 | `database/` 保存当前 SQL 与编号迁移，`db:init` 自动迁移、补齐与收敛 |
| 发布 | 推送 `v*` 标签后 CI 构建镜像并创建 GitHub Release |

模块边界与数据权限见 [项目架构](docs/manual/Architecture.md)。

## 仓库结构

```text
src/                 Next.js 应用：页面、API 路由、组件与业务模块
packages/core/       taibu-core：算法、工具定义、方法与规范输出（MIT）
packages/mcp/        taibu-mcp：本地 stdio MCP Server（MIT）
packages/mcp-server/ taibu-mcp-server：公共 HTTP MCP Server（MIT）
skills/              taibu-divination Skill 与方法卡源文件
database/            PostgreSQL 当前定义、角色初始化与编号迁移
deploy/              Compose、Caddy、备份、部署与更新脚本
scripts/             构建、数据库工具、自托管、发布与测试
docs/                手册、工程规范与升级说明
android/ ios/        Capacitor 客户端
```

## 开发

```bash
pnpm test                         # 单元、路由、协议与守卫测试（自动构建所需的包）
pnpm test -- src/tests/chat-route.test.ts   # 只跑指定文件
pnpm lint && pnpm typecheck
pnpm test:db                      # 在临时 PostgreSQL 中验证 SQL、RLS 与并发
pnpm exec playwright install --only-shell chromium   # 首次运行浏览器测试前
pnpm verify                       # 完整验收：构建、全部测试、数据库、认证与浏览器（需要 Docker 与本地栈）
```

开发约定见 [AGENTS.md](AGENTS.md) 与 [工程与设计规范](docs/engineering/README.md)，测试分层见 [测试与验收](docs/engineering/testing.md)。提交使用 Conventional Commits。

## 文档

| 文档 | 内容 |
| --- | --- |
| [自托管手册](docs/manual/Self-Hosting.md) | 本地栈、数据库、邮件、计费、发布、部署与备份 |
| [升级说明](docs/UPGRADE.md) | 从旧部署升级到 1.0.0，以及之后的版本更新 |
| [项目架构](docs/manual/Architecture.md) | 运行组成、模块边界、数据权限与计费 |
| [Agent 手册](docs/manual/Agent.md) | Agent 的任务、工具、扩展、协作、定时任务与计费 |
| [MCP 手册](docs/manual/MCP-Server-Manual.md) | MCP 客户端配置、协议行为、工具与自部署 |
| [taibu-core](packages/core/README.md) · [算法规则](packages/core/ALGORITHM_RULES.md) | SDK 用法、输出契约与算法口径 |
| [工程与设计规范](docs/engineering/README.md) | 代码、组件、前后端、数据安全、测试与文档规范 |

## 版本

应用版本以根目录 `package.json` 为准，遵循 `x.y.z`：x 是重大架构变更，y 是功能新增，z 是问题修复。npm 包各自维护版本，当前为 `taibu-core`、`taibu-mcp`、`taibu-mcp-server` 4.0.0。发布流程见 [自托管手册](docs/manual/Self-Hosting.md#版本与镜像发布)。

## 贡献

欢迎提交 Issue 与 Pull Request。提交前请阅读 [AGENTS.md](AGENTS.md)，并在 PR 中写明改了什么、为什么改、如何验证。

## 许可证

本仓库采用混合许可证：

- `packages/core`、`packages/mcp`、`packages/mcp-server` 采用 [MIT](packages/core/LICENSE)，允许商用、再分发与二次开发，需保留版权与许可声明；
- 其余 Web、服务端、部署与运行时代码采用 [AGPL-3.0-only](LICENSE)：不禁止商用，但修改后对外提供网络服务时须开放相应源码。

第三方组件的许可见 [licenses/](licenses/) 与 [THIRD_PARTY_NOTICES.md](packages/core/THIRD_PARTY_NOTICES.md)。

---

<div align="center">

**太卜** · 用 AI 解读命运，用科技传承文化

Made with ❤️ by [hhszzzz](https://github.com/hhszzzz)

</div>
