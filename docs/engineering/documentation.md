# 文档、版本与发布说明规范

本文约束仓库文档的分工、写法和同步时机，以及应用与 npm 包的版本号、更新日志和发布步骤。规范用语（必须 / 应该 / 可以）见 [工程与设计规范 §1](README.md#1-规范用语与效力)。

## 1. 文档分工

每类内容只有一个归属。一件事只在一处写全，其他位置给链接，不复制段落。

| 文档 | 写什么 | 不写什么 |
| --- | --- | --- |
| `README.md` / `README.en.md` | 产品是什么、能做什么、怎样开始、细节去哪里看 | 操作手册全文、实现细节、内部流程 |
| `CHANGELOG.md` | 每个版本对用户和运维可见的变化、升级须知 | 测试与样式提交、无外部影响的重构 |
| `docs/UPGRADE.md` | 跨版本升级与迁移步骤、被删除的数据、升级后要重新配置的项 | 功能介绍 |
| `docs/manual/` | 当前的架构、运行、部署、Agent 与 MCP 行为和边界 | 一次性切换记录、过时方案 |
| `docs/engineering/` | 研发规范与评审清单 | 产品介绍、运维步骤 |
| `AGENTS.md` | 给 AI 编码代理和新开发者的最短约定与索引 | 规范全文（链接到本目录） |
| `packages/*/README.md` | npm 包页面：安装、用法、契约、版本批次 | 站内功能 |
| `packages/core/ALGORITHM_RULES.md` | 算法口径、来源与验证范围 | 用法示例 |

- 手册描述**当前**事实。迁移、切换、演练的过程写进提交说明或更新日志，不在手册里保留历史章节。
- 审查报告、验收记录与调研笔记是某一时刻的过程材料：结论要落到规范、手册、测试或提交说明里，原始材料不作为事实来源。确需入库的放在 `docs/reviews/`，标题写明范围与日期。
- 生成物只由生成脚本更新，不手改：Skill 的 `SKILL.md` 工具表、`references/`、`scripts/vendor/`（`scripts/build-skill-bundle.mjs`），方法目录与 `methods.generated.ts`（`pnpm build:methods`），`src/lib/db/generated/`（`pnpm db:codegen`）。

## 2. 事实与数字

- 文档里的数字、名称和默认值（工具数、方法数、图表模板数、端口、限额、版本号）必须取自当前代码或配置，写之前查证；查不到确切值的不写具体数。
- 工具与方法的数量写在多处：根 README（中英文）、`packages/core|mcp|mcp-server/README.md`、`docs/manual/MCP-Server-Manual.md`、Skill 的 `SKILL.md`，以及 `src/lib/mcp-service-config.ts` 的 `MCP_PUBLIC_TOOLS`。增删工具或方法时一起改，Core README 的工具表由 `domain-registry-guard` 测试守护。
- 尚未实现的目标状态不得写成已可用（见 [工程与设计规范 §4](README.md#4-当前约束与目标规范必须区分)）。
- 文档描述线上服务（在线站点、公共 MCP Server）时，服务的部署版本要与文档一致；做不到时先更新服务，或在文档中写明差异。

## 3. 写作

- 默认中文。根 README 另有英文版，两者结构与事实保持一致，修改时同时更新。npm 包 README 与手册只维护中文。
- 先写读者要做什么、怎么做，再写原因；一段只讲一件事，句子短。用户能看到的名称（菜单、按钮、设置项）照界面原文写，并用「」标出。
- 中文与英文、数字之间加空格（`26 个工具`、`Agent 手册`）；全角标点，代码、命令、路径、变量与表名用反引号。
- 术语保持一致：Agent、worker、BYOK（自定义模型）、MCP 服务（管理员接入）与连接器（用户添加）、方法（内置）与技能（SKILL.md）、钱包与订阅。
- 不用无法验证的宣传语（「最强」「全网首个」），不与其他产品作没有依据的比较。
- 代码块标注语言，命令可以直接复制执行；示例用 `example.com`、`203.0.113.x` 这类保留地址。
- 链接用仓库相对路径，锚点必须存在；外部依据优先链接一手文档。
- 不写真实密钥、生产数据、用户隐私、个人路径和内部主机地址。
- 代码注释的写法见 [代码风格 §7](code-style.md#7-注释与文档)。

## 4. 什么时候更新文档

文档与代码在同一个变更里更新；只改实现不改文档时，不能声称行为已经变化。

| 变更 | 必须同步 |
| --- | --- |
| 用户可见的新功能或行为变化 | 对应手册；影响产品概览时更新 README（中英文） |
| 新增或删除环境变量 | `.env.example` 与使用它的手册章节 |
| 数据库结构 | `database/` 当前 SQL、需要时的编号迁移、生成类型；需要运维动作时写进 `docs/UPGRADE.md` |
| Core 工具、参数或方法 | 第 2 节列出的各处工具表、Skill 生成物，以及 `pnpm build:methods` |
| 部署、备份或更新脚本 | `docs/manual/Self-Hosting.md`，以及受影响的升级步骤 |
| 破坏性变更 | 提交带 `!` 和 `BREAKING CHANGE:` 脚注，脚注写清运维要做的事；同步 `docs/UPGRADE.md` |

## 5. 版本号

- **应用**：版本以根 `package.json` 为准，格式 `x.y.z`：x 是重大架构变更，y 是功能新增，z 是问题修复。镜像与 Git 标签都写作 `v<版本>`，例如 `v1.0.0`。
- **npm 包**：`taibu-core`、`taibu-mcp`、`taibu-mcp-server` 各自遵循语义化版本，与应用版本无关。删除或改名导出、收紧输入 schema、删除或改变 canonical JSON 字段，都属于破坏性变更，升主版本；新增工具、参数或可选字段升次版本；只修正结果的升修订号。
- `taibu-mcp` 与 `taibu-mcp-server` 依赖同仓库的 `taibu-core`，发布时三者使用同一个主版本；每次发布在各包 README 的「版本批次」表记一行。
- 已经改了版本号但还没发布的包，在提交说明里注明 `(not published)`，发布前按期间的变更重新确认版本号。

## 6. 更新日志与发布说明

- `CHANGELOG.md` 每个版本一段，标题为 `## vX.Y.Z · YYYY-MM-DD`，新版本在上。`release.yml` 用 `pnpm release notes <版本>` 取同一段作为 GitHub Release 正文，应用内的更新弹窗显示的也是它。
- **常规版本**：`pnpm release prepare <major|minor|patch>` 按上一个标签以来的 Conventional Commits 生成段落。提交、打标签之前先用 `--dry-run` 预览，合并重复条目，删掉对外无意义的条目。
- **首个版本与主版本**：手写段落，依次是一段概述、亮点、按领域的变化、npm 包版本、升级须知与已知限制。版本号、`CHANGELOG.md` 与标签照常提交，提交说明为 `chore(release): vX.Y.Z`。
- 「升级须知」不能省略：需要执行 SQL、重新填写配置或密钥、会删除数据的变更都要列出并链接 `docs/UPGRADE.md`；没有就写「无」。
- 发布说明写给用户和运维看：不写会话、内部主机和人名，也不复制提交列表里的实现细节。

## 7. 发布步骤

1. 确认 `pnpm verify` 通过，`CHANGELOG.md`、`docs/UPGRADE.md`、README 与手册已同步。
2. 生成版本提交与注释标签（`pnpm release prepare`，或手写首个/主版本段落后自行提交并打标签），推送分支与标签。CI 构建镜像 `ghcr.io/hhszzzz/taibu:<标签>` 并创建 GitHub Release。
3. 主机执行 `deploy/deploy.sh <标签>`，或由管理员在应用内一键更新，然后核对 `/api/health/ready` 与关键页面。
4. npm 包有变化时：先 `pnpm test:npm-packages`，再按 `taibu-core` → `taibu-mcp` → `taibu-mcp-server` 的顺序用 `pnpm publish` 发布（它会把 `workspace:*` 改写成实际版本号；`npm publish` 不会）。认证使用 npm access token，不依赖 OTP 交互；发布后用 `npm view <包> version` 核对。
5. 公共 MCP Server 等线上服务按新版本更新，与第 2 节的一致性要求对齐。

## 8. 文档检查清单

- [ ] 内容放在第 1 节规定的位置，没有在两处各写一份。
- [ ] 数字、默认值、命令与路径已对照当前代码查证。
- [ ] 中英文 README 同步；链接与锚点有效。
- [ ] 需要运维动作的变更已写进 `CHANGELOG.md` 的升级须知与 `docs/UPGRADE.md`。
- [ ] 生成物由脚本重新生成，没有手改。
- [ ] 没有密钥、生产数据、隐私与内部地址。

## 参考

- Keep a Changelog 1.1.0：<https://keepachangelog.com/zh-CN/1.1.0/>
- 语义化版本 2.0.0：<https://semver.org/lang/zh-CN/>
- Conventional Commits 1.0.0：<https://www.conventionalcommits.org/zh-hans/v1.0.0/>
- 中文文案排版指北：<https://github.com/sparanoid/chinese-copywriting-guidelines>
- pnpm publish：<https://pnpm.io/cli/publish>
- npm access token：<https://docs.npmjs.com/creating-and-viewing-access-tokens>
