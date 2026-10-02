# 重构验收记录（2026-10-02）

## 结论与范围

本轮重构实现、测试精简及下述本地分层验收已完成；**原计划的全部验收门槛尚未闭环，不能标记为 P0–P7 全部验收完成。** 仍保持模块化单体、现有 Web/Core/MCP 包边界和部署平台。生产部署、发布和生产 migration 未执行；后续提交/推送仅限用户另行授权的验收分支与草稿 PR。Docker 测试不代表完成生产容器化或退出 Supabase。

架构与兼容规则见 [Architecture.md](Architecture.md)，SQL 来源与执行边界见 [supabase/README.md](../../supabase/README.md)。完成表示本记录列出的代码和测试范围通过，不表示已经取得生产 Auth/PostgREST 等价性或线上数据定义完整性证明。

## 阶段交付

| 阶段 | 本轮完成项 |
|---|---|
| P0a | 修复原有 122 条测试类型错误；保留 strict 和测试范围；补齐显式 SQL 输入、缺失输入诊断、质量 CI、独立类型和产物检查命令 |
| P0b | 建立来源可追溯的隔离 PostgreSQL/pgvector 契约测试，覆盖真实 RLS、RPC、并发和回滚；新增两份经本地验证的修复 migration；不宣称完整迁移链或生产权威基线 |
| P1 | 独立 session context；基础 hooks 不再依赖 Provider 装配；Bearer 成功路径提供用户态数据库客户端；上下文缺失拒绝，不回退管理员 |
| P2 | 非空模型来源清单具有权威性；禁用/固定网关过滤后不恢复旧来源；聊天和占术落实会员→积分→限流，并补扣费后拒绝/异常的一次补偿测试 |
| P3 | 提取无 HTTP/Supabase 类型的聊天准备用例；保留托管/直连、浏览器保存及跨路由任务的不同职责 |
| P4 | 提取分析准备、终态/保存/补偿用例；塔罗完成 HTTP/SSE、真实 SQL/RLS 与浏览器纵向验证；不把三层桩测试误称完整平台联调 |
| P5 | 会话列表由用户隔离的 Query 单独持有；迁移设置 mutation 显式副作用；管理模型面板拆为受控表单/来源视图与编辑辅助函数 |
| P6 | 拆分浏览器数据 DTO 与服务器 provider 契约；历史回放策略显式化但不改算法；知识库窄持久化维持单 RPC 原子替换；用户检索和入库保留调用者身份 |
| P7 | 增加新用例/DTO/身份/缓存守卫和负例测试；校准文档；保留仍有调用者的兼容入口；验证包许可证、依赖替换和 Skill 规范输出；产物测试使用自动清理的临时目录 |

复核另发现并修正两个集成问题：

1. 认证刷新后旧 Cookie token 仍被传给知识库。新增 8 个场景修复前有 6 个失败；现在 managed/trusted/direct/preview 均使用已解析的 `auth.accessToken`，Bearer 不借 Cookie 刷新。
2. 禁用的 Query observer 缺少 `queryFn`，实际 Next 开发渲染会警告。改用 `skipToken`，不启用自动抓取，不改变显式列表请求协调。

## 第一轮工程结果（测试精简前的已通过基线）

本机环境：macOS，Node `24.21.0`、pnpm `10.28.1`。新增 GitHub workflow 使用 Node 20、pnpm 10.33.0；**未触发远程 CI**。

| 命令/检查 | 主工作区结果 | 干净源码候选结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 沿用本机现有安装 | 成功重新安装；lockfile 未改变 |
| `pnpm lint` | 通过，含架构守卫 | 通过 |
| `pnpm typecheck` | 通过，0 TS 错误 | 通过 |
| `pnpm test` | **993/993，0 fail、0 skip** | **993/993，0 fail、0 skip** |
| `pnpm build` | 通过 | 通过 |
| `pnpm test:npm-packages` | **17/17** | **17/17** |
| `pnpm test:github-packages` | **3/3** | **3/3** |
| `pnpm test:db` | **22/22，0 skip** | **22/22，0 skip** |
| `git diff --check` | 通过 | 不适用（无提交的源码候选） |

干净候选只复制已跟踪文件及本轮明确新增、未被忽略的源码；没有复制 `node_modules`、`dist`、`.next`、真实 `.env` 或其余忽略的本地 SQL。临时初始化 Git 仅供 ignore 检查，没有创建提交。首次 `--offline` 安装因本机 store 缺少锁定 tarball 失败，随后按 lockfile 从 npm registry 获取依赖并完成全链路；这不是业务或编译失败。

17 项产物检查包含：npm tarball 不残留 workspace 协议/旧服务端鉴权构建文件、包内 LICENSE 与源包一致，以及 Skill manifest 和 15 个固定时间/随机数/seed 示例的规范文本、结构化 JSON 与当前 Core 一致。并非重建 Skill 后再比较，实际验证的是仓库中随 Skill 分发的 bundle。

## 浏览器验收

### 实际组件集成：24/24

入口：[scripts/tests/p5-browser-fixture.mjs](../../scripts/tests/p5-browser-fixture.mjs)。使用已有 Playwright 和独立临时 Chromium profile，开启 offline 并拦截全部请求；29 个 fixture HTTP 请求，0 未处理请求、0 浏览器运行时异常、0 missing-queryFn 警告。

覆盖：

- 实际设置中心 hash、Back、关闭重开保活；一次 mutation 只失效一次。
- 实际会话 Context/Query 的 7+2 分页、重命名/删除失败回滚、旧账号迟到请求与回滚隔离、退出清缓存。
- 实际 ChatStreamManager 的跨 fixture 页面存活、停止保存部分内容一次、重新生成完成保存一次。
- 实际模型管理面板的创建/编辑草稿、固定网关联动、来源新增/编辑、参数归一化、无效 JSON 拒绝。

身份、无关懒加载面板、导航外壳、HTTP 和模型执行是控制桩；这不是 Next 路由或真实登录测试。第一轮使用显式模块路径运行；后续已固定 Playwright 开发依赖并纳入 CI。当前复现入口：

```bash
pnpm exec playwright install --only-shell chromium
pnpm test:browser
# 本机无法下载 Chromium 且已有 Chrome 时，显式选择，不减少断言：
pnpm test:browser -- --chrome
```

### 实际 Next 应用旅程

从无 `.env` 的源码副本启动真实 Next 16.1.1 webpack 开发服务，仅监听 `127.0.0.1`；Supabase 地址指向不可用的本机占位端口。浏览器使用独立 profile，非本地请求全部阻止，只有免费抽牌请求进入实际本地 API/Core；认证、引导数据、保存和模型响应由受控桩提供。

已操作并检查截图：

1. 塔罗输入问题、选择牌阵、实际 API 抽牌、翻牌；匿名页面显示登录门槛。
2. 模拟已登录会话后触发托管解读，只有一次 interpret 请求，流文本实际渲染。
3. 设置标签页内的测试 BYOK 配置：prepare → 浏览器供应商桩 → persist 各一次；测试密钥未进入平台请求体。
4. 从实际历史页恢复保存牌面与分析，没有再次抽牌。
5. 在历史卡片打开实际知识库弹窗，选择知识库并提交正确的 `tarot_reading` 来源，显示加入成功。

最终 0 浏览器运行时异常、0 未配置/外部请求。开发模式 StrictMode 会重复执行原有免费抽牌 mount effect；这不属于付费推理重复调用。保留的 Next 图片 `sizes`/LCP 及 smooth-scroll 提示未夹带修正，不能将结果写成“零 warning”。本次没有操作真实账号或产生真实 AI 费用。

## 真实数据库验收的含义

`pnpm test:db` 使用真实 PostgreSQL 16、pgvector、RLS 和事务；验证两名普通用户、管理员登录态与实际 service_role。包括并发扣减/流水、会话/规范消息一致性、知识块替换/归档、真实全文/相似/向量检索、塔罗旧记录绑定/新建/越权拒绝及注入写失败的回滚。

`auth.uid()`/`auth.role()` 和 claim settings 是明确的测试 fixture，不验证 JWT 签名、Supabase Auth、Cookie/OAuth 或 PostgREST。新增搜索函数/ACL 和 ledger RPC 权限修复只在临时数据库执行；没有新表、字段、索引或回填，42 表快照不变。每次仅清理本次标签匹配的容器，不操作其他容器或关闭全局 Docker。

## 保留的兼容与发布门槛

- 底层限流器仍保留原 fail-open。被其捕获的 RPC 错误会继续放行；用例只补偿明确拒绝或实际传播的异常。
- KB RPC 错误转空结果、向量距离 `0` 的旧 fallback 尚未纠错；独立列为后续工作，不夹带排序算法变化。
- 空结果、部分输出、SDK 中止、后置保存 hook 和财务退款之间仍有历史差异，详见架构矩阵；不承诺跨请求/进程 exactly-once。
- Query observer 故意不自动抓取；旧 DOM 事件、URL 推断和仍有消费者的 facade 保留，删除条件已记录。
- 生产前必须另外核对真实数据库函数/ACL/owner/扩展位置和已应用迁移；需要授权后通过 Supabase MCP 执行 migration。当前材料不是完整可部署数据库基线。
- 真实 OAuth、邮件、付费供应商、移动端真机、生产迁移仍不在已验证范围。后续已补真实本地 Auth/PostgREST 联调与验收分支 CI，具体范围和精确版本见文末；不能由此推定生产等价。Docker 生产化和平台替代继续留在后续 F1–F3。
- 用户原有 `AGENTS.md`、`GEMINI.md`、`.codex-deploy/`、`skills/notion-style.md` 未被本轮改写。

可回滚边界按用例、mutation、面板及领域分别保留；安全纠错不应回退到管理员 fallback、被禁用模型来源或宽松 ledger ACL。生产数据库优先采用经审核的前向修复，不提供破坏数据的 down migration。

## 后续测试精简与原计划收尾

用户确认保留单仓，优先精简测试维护成本。此次没有改变业务源码、Core 算法、数据库行为或 HTTP 协议；基于第一轮验收源码副本的比较确认 `src` 非测试实现未改变。

### 具体收敛

| 内容 | 精简前 → 精简后 | 保留的保护 |
|---|---|---|
| 塔罗、奇门、六爻测试及公共 route helper | 2,380 → 1,446 行，净减 **934 行** | 原 24 个测试名称和 137 个断言调用全部保留，另增 7 个断言；保留显式鉴权/扣费/模型/保存替身 |
| 浏览器状态、设置导航、数据源边界测试 | 651 → 519 行，净减 **132 行** | 会员六状态运行时矩阵、真实导航投影/链接/历史调用、DTO/服务器边界；独有安全及时间宽限守卫仍保留 |
| 共享占术路由准入组合 | 39 → 13 个适配测试 | 三种传输成功和拒绝、各 HTTP 错误映射、退款失败/抛错接线；完整 3×3 补偿组合仍由纯用例测试覆盖 |
| 聊天路由限流补偿组合 | 6 → 4 个适配测试 | 不同 HTTP 映射及两类退款失败适配；完整 2×3 组合仍在聊天纯用例测试 |
| 默认测试用例 | 993 → **968** | 去除跨层重复与合并同义断言，同时新增 9 个执行器测试；没有删除鉴权、积分或 SQL 事务责任层 |

全部 `.test.ts` / `.test.mjs` 文件合计 **33,035 → 32,158 行，净减 877 行**；另有公共 helper 净减 107 行。文件数 **145 → 146**，新增的是执行器自身回归测试；没有为减少文件数量而合并不相关测试，也没有用巨型 fixture 搬运原有重复代码。

删除了无调用者的旧 `setupRouteTest` 装配器及类型/重导出，去掉三个领域测试中的 22 处模块缓存清理和 69 处 `as any`。使用 `t.mock.method` 自动恢复、现有流替身及明确的单项权限能力。六爻原有一个 Mock 没有接入实际执行路径，改为在真实 chart bundle 入口注入相同不匹配数据，并断言 Mock 确实执行。

### 执行方式

- `pnpm test -- <文件或测试目录>`：显式选取并构建必要包；只测 Web 时不构建 MCP。缺失路径或空选择失败，不根据 Git 改动猜测范围。
- `pnpm test`：默认单元、路由、Core、MCP 与工程守卫，保持独立调用的构建前置条件。
- `pnpm verify`：每个包只构建一次，再顺序完成 lint、strict、默认测试、Next 构建、包/许可证/Skill、真实 DB 和浏览器组件检查。任一步失败都终止；不暴露默认跳过构建的旧 dist 通道。
- 原完整顺序的包构建由 10 次降为 3 次；这是命令执行次数，不是未经测量的性能或耗时承诺。
- `quality.yml` 现在运行同一个完整入口，安装 Chromium headless shell，并强制执行 DB 和浏览器层。Playwright `1.63.0` 只加入开发依赖及 lockfile，不引入 `@playwright/test` 或第二套断言框架。

被删除的设置保活/按用户初始化源码拼写断言，映射到**必跑**浏览器层；又补充同用户父组件重渲染不重复加载、换账号加载一次、退出不读取、重新登录加载等 4 个断言。浏览器检查从 **24 → 28**，不是迁到一个可选的手动检查后失去保护。

### 精简后的最终验证

| 检查 | 结果 |
|---|---|
| 主工作区 `pnpm test` | **968/968，0 fail、0 skip** |
| 主工作区 lint / strict | 通过 |
| 主工作区 `pnpm test:browser -- --chrome` | **28/28**，29 个 fixture 请求，0 未处理外部请求或浏览器异常 |
| 全新源码候选离线 frozen install | 通过；不复制旧 node_modules、dist、.next 或真实 .env |
| 干净候选 `pnpm verify -- --chrome` | **完整通过**：各包构建一次、lint、strict、968 测试、Next 生产构建 |
| 同一完整入口的包/许可证/Skill/GitHub 产物层 | **20/20**（原 17+3） |
| 同一完整入口的真实 PostgreSQL 层 | **22/22**，0 skip，容器清理通过 |
| 同一完整入口的浏览器层 | **28/28** |

本机 Chromium 下载遭遇连接超时；长超时重试后停止该下载，显式选择已有 Chrome 完成相同断言，没有静默 fallback 或跳过测试。固定 Chromium 的 CI 配置仍保留，**远程 CI、其 Node 20 环境及该浏览器二进制未在本机实测**。

已完成代码、文档、包/Skill、隔离 SQL 和受控浏览器的本地交付；这不能替代下列尚未完成的验收门槛。第一轮临时 Next 服务已停止，完成验证的源码副本已清理，测试容器与默认浏览器 fixture 自动清理；没有停止全局 Docker 或修改其他会话的浏览器。第一轮结束时未提交或推送；后续授权范围与进展见文末，生产平台及迁移执行边界不变。

## 原验收缺口与当前状态

| 项目 | 当前证据与边界 | 状态 / 后续条件 |
|---|---|---|
| 数据库权威定义核对（P0b 的定义缺口） | 19 项本地 SQL 清单不是线上最终函数、RLS、ACL 与已应用迁移的权威证明 | 获准读取的完整定义/迁移记录导出，或明确授权的只读环境；形成差异清单，核对函数 owner、扩展 schema、策略与 RPC 授权。不得从历史文件推断已经部署 |
| 真实鉴权与纵向联调（P1/P4） | 已补独立 GoTrue/PostgREST/PG，真实 JWT、Cookie、用户更新、塔罗/BYOK/历史/知识库联调 17/17 通过；模型仍为桩，非完整 Next 浏览器端到端 | 本地授权范围已完成；不代替生产定义、OAuth/邮件或付费供应商验收 |
| 候选代码远程 CI（P7） | 首个候选 `d959896` 已在 Node 20.20.2＋固定 Chromium 通过；真实平台测试补入后的最终候选仍需再次验证 | 已获提交/推送与草稿验证 PR 授权；每次以确切候选版本的 quality workflow 结果为准，旧提交结果不能代替后续代码 |

数据库权威定义仍未标记完成，不能通过再次运行相同的本地测试消除缺口。自动目标提醒不提供环境访问、代码上传或生产操作授权。生产 SQL 应用、上线及 F1–F3 平台迁移另行授权，不与上述非生产验收混为一项任务。

## 授权续验（进行中）

用户随后通过交互明确选择：

- 允许创建完整临时本地 Auth/PostgREST 测试栈，下载必要 Docker 镜像；不挂载已有数据、不连接生产，完成后清理。
- 数据库权威定义由用户提供最新导出；目前未收到文件或路径，**没有改为授权读取线上元数据**。
- 允许创建验收分支，仅提交/推送本轮改动并创建验证 PR；不合并、不部署，不包含用户原有独立改动。

验收分支为 `refactor/modular-acceptance-20261002`，先以 fast-forward 纳入远端 `0d188be` 及其已有的奇门、每日聊天修复，没有覆盖这些上游改动。远端仓库为公开仓库；发布前排除用户独立文件并检查敏感内容。

现有 GitHub/Vercel 集成有自动部署记录，因此依据 [Vercel 官方 Git 配置文档](https://vercel.com/docs/project-configuration/git-configuration)，在 `vercel.json` 中仅将该验收分支的 `git.deploymentEnabled` 设为 `false`，未更改其他分支默认部署行为。此分支/PR 仅用于验证，不作为生产发布。远程 CI 与真实平台联调的完成状态必须等待实际运行结果，不能由授权本身推定通过。

首个候选已提交为 `d959896daf9cc8abfb097a8b561ef1146b0ce0ed`，推送到验收分支并建立[草稿 PR #16](https://github.com/hhszzzz/taibu/pull/16)。[quality run 36970663553](https://github.com/hhszzzz/taibu/actions/runs/36970663553) 已成功：Node 20.20.2、固定 Chromium、1139/1139 默认测试、20/20 产物、22/22 隔离 SQL、28/28 浏览器检查，均无失败或跳过；生产构建与类型/lint 通过。该提交的 GitHub deployment 查询为 0，PR 未合并。一次本地 `gh run watch` 的 TLS 超时不代表工作流失败，已用 run conclusion 与实际日志交叉确认。

### 真实平台续验与 Auth 修复

已补 `local-auth-stack.mjs` / `auth-postgrest-acceptance.test.mjs`，复用原 SQL fixture 的显式 GoTrue 模式。17/17 通过；真实 Auth 建立身份、签发 JWT，PostgREST 校验签名并执行 RLS/RPC。实际应用处理器、持久化和鉴权未 Mock，只有模型推理受控。BYOK 通过本地 HTTP adapter 调用实际处理器；这不是完整 Next/UI 端到端，也不含 OAuth、邮件、Storage、Realtime 或 TLS。

本次联调发现并修复两个原有 Auth 缺陷：

1. `createAuthedClient()` 仅设置 Authorization，`auth.signOut()` 因 SDK 会话为空而不发送 `/logout`。旧行为会清 Cookie 却留下可用 refresh token。改为使用已验证调用者 JWT 发起全局 logout，不获取 service-role/管理员客户端。真实测试确认 refresh token 失效，并明确旧 access JWT 在到期前仍可能被 PostgREST 接受。
2. 同类空会话导致 `auth.updateUser()` 返回 `Auth session missing!`。通过 `api-utils.ts` 的请求独享内存会话客户端修复，支持 Cookie 和仅 Bearer；资料/密码更新失败时仍保留已轮换的 Cookie。补充匿名/错误拒绝、刷新凭据、请求间隔离测试，不使用管理员更新接口。

原有 SQL suite 仍为 22 项；真实模式增加 7 项明确历史输入，其中 5 个首次纳入版本控制。缺失的 rate-limit sequence/unique index 与入口表授权是 fixture 假设，不是生产结构证明，详见 [数据库说明](../../supabase/README.md)。没有整体回放历史迁移。

### 当前候选的完整本地验证

命令：`DOTENV_CONFIG_PATH=/dev/null NEXT_TELEMETRY_DISABLED=1 pnpm verify -- --chrome`。

| 层 | 实际结果 |
|---|---|
| 各包构建 / lint / strict | 通过，每个包构建一次 |
| 默认单元、路由、Core/MCP、守卫 | **1152/1152，0 fail、0 skip** |
| Next 生产构建 | 通过 |
| 产物、许可证、Skill | **20/20** |
| 真实 PostgreSQL/RLS/事务 | **22/22，0 skip** |
| 真实 Auth/JWT/PostgREST 纵向联调 | **17/17，0 skip** |
| 离线浏览器组件 | **28/28**，29 个 fixture 请求，无外部请求或运行时异常 |

17 项计数包含外层 suite 和远程 Docker 拒绝检查，并非 17 个独立业务流程。默认测试从上游合入后的 1139 增至 1152，新增 13 项 Auth 安全回归；原测试精简统计保留在前文作为对应版本的历史记录。

真实栈本次主工作区运行 `b63beaf1-0f4f-4988-81ef-1712d3439d04` 清理后，容器/网络/卷均为 0；成功、故意断言失败与 SIGTERM 路径也分别验证清理。不停止全局 Docker，不删除共享镜像缓存，不承诺 SIGKILL/宿主崩溃时自动清理。完整入口和 CI 已强制加入真实 Auth/REST 层，`pnpm test:auth` 可独立复现并自动构建 Core。

**远程证据按 SHA 记录在[草稿 PR #16 的检查与说明](https://github.com/hhszzzz/taibu/pull/16)。** 新候选必须实际通过该提交的 quality workflow，不能沿用 `d959896` 的成功结果；本记录中的本地结论不是预先宣称远程通过。数据库权威导出仍未收到，原计划因此仍不能标记全部验收闭环。
