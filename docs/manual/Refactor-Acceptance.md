# 重构验收记录（更新至 2026-10-03）

## 结论与范围

**本轮独立复核发现的架构收尾项及完整本地验收已完成。** 保持模块化单体、现有 Web/Core/MCP 边界；没有新框架、主表或平台替换。用户随后批准将本轮收尾追加到现有草稿 PR #16；新提交的远程结果须按确切 SHA 核对，不能用上一轮 `02073ff` 的 CI 替代。三份数据库修复已在此前独立授权中应用，本轮没有再操作生产数据库。

> 本节与下方“当前架构收尾验收”描述当前候选；再往后的阶段记录保留历史事实，其中“未应用”“未授权”和旧测试数量均是当时状态。[草稿 PR #16](https://github.com/hhszzzz/taibu/pull/16) 记录候选提交、对应 CI 与部署状态，本文表格是提交前已完成的本地验证，不提前宣称远程通过。

架构与兼容规则见 [Architecture.md](Architecture.md)，SQL 来源与执行边界见 [supabase/README.md](../../supabase/README.md)。完成表示本记录列出的代码和测试范围通过，不表示已经取得生产 Auth/PostgREST 等价性或线上数据定义完整性证明。

## 当前架构收尾验收（2026-10-03）

基于 `02073ff` 的工作区修改，逐项完成独立审查发现的问题：

| 项目 | 当前行为与回归 |
|---|---|
| 设置账号生命周期 | 账号级保活边界；旧 GET/PATCH 与副作用取消；同账号 focus 不覆盖草稿；保存期间新编辑保留；退出再登录的旧请求不能复活状态 |
| 设置/提醒写入身份一致性 | 可选 `X-Expected-User-Id` 在认证后、数据访问前检查；Cookie 已换账号而 UI 未同步时拒绝旧草稿；旧客户端兼容，客户端 ID 不赋予权限 |
| 会话同账号并发 | 同 ID 写入不交错，不同 ID 可并行；目标字段/条目回滚，刷新保留待确认操作；删除成功后的旧在途读取被取消并协调，不能复活记录 |
| 分页与刷新 | 请求接管重置旧加载模式；过期 finally 不覆盖新状态；加载更多被刷新抢占后可继续分页 |
| 模型编辑 | 刷新协调脏字段，保存来源不丢其他模型草稿；重叠旧 GET 不覆盖新读取，卸载后不继续 reload |
| 请求观测 | 可信 request ID、阶段/耗时与生成/保存/计费终态；退款 false/throw 分类；限定失败枚举；日志接收函数失败不影响业务；延迟流转换错误也有终态 |
| KB 正确性 | 保留向量距离 0；RPC 错误与空命中分离，部分阶段成功保留结果，全失败明确报错；不吞掉调用者身份缺失 |
| 低风险精简 | 请求内复用预算、人格与同账号 KB 名称；独立调用和缺失名称仍回退；移除未使用权重读取，浏览器标签独立为纯数据模块 |
| 依赖守卫 | TypeScript AST 追踪直接/间接导入、重导出、类型、别名与循环；新增模块纳入；Node 内建及 AI SDK 不能借裸模块名绕过；37 项守卫测试通过 |

浏览器使用实际 `ClientProviders` 的 focus/会话同步、设置/模型/会话组件及 Query；认证 I/O、特性、无关外壳和 HTTP 仍为明确受控桩，不冒充生产登录。保留旧检查，新增延迟响应和交错时序，最终 **54 项检查、117 个 fixture 请求，0 外部请求、0 浏览器运行时异常**。

修复前已复现：旧账号一致性检查缺失、同账号 focus 草稿丢失、模型 reload 草稿丢失、分页刷新后卡住，以及旧模型重叠读取覆盖。评审补充并修复删除成功后迟到刷新复活、特殊格式化错误漏补偿和延迟流转换漏终态。新增特征测试用于证明行为，不以“缺少新函数”的红灯代替交互复现。

### 完整验证结果

为避免构建读取主工作区真实 `.env`，使用仅包含当前源码与明确新增文件的独立临时副本，排除真实环境文件、旧 dist、`.next`、私有证据及用户独立改动。`pnpm install --offline --frozen-lockfile` 成功；依赖独立安装，不链接父目录旧产物。清空继承业务环境后执行：

```bash
DOTENV_CONFIG_PATH=/dev/null NEXT_TELEMETRY_DISABLED=1 pnpm verify -- --chrome
```

| 层 | 最终结果 |
|---|---|
| 三个包构建、lint、架构守卫、strict | 全部通过，每包在完整入口构建一次 |
| 默认单元/路由/Core/MCP/工程测试 | **1223/1223，0 fail、0 skip** |
| Next 生产构建 | 通过 |
| 产物、许可证与 Skill | **20/20** |
| PostgreSQL/RLS/事务 | **34/34** |
| 真实 Auth/JWT/PostgREST | **21/21** |
| 离线浏览器组件 | **54/54** |

第一次完整运行因新增格式化回归测试使用了不具备构造签名的测试替身而在 strict 阶段停止；改为实际类型化错误构造器后，从构建开始完整重跑通过，未放宽 strict 或跳过后续层。执行器测试内预期的 `fixture failure` 输出不是最终测试失败。

最终应用、测试及配置文件与验证副本逐文件摘要核对；验证后只更新结果文档。临时 Auth 栈清理后容器/网络/卷均为 0，不删除共享镜像、不停止全局 Docker。

**边界：**本轮没有新迁移、生产访问、合并、部署或 npm 发布；本地验收完成后，用户单独批准提交/推送至现有验收分支并更新草稿 PR。真实 OAuth/邮件、付费供应商、历史数据审计、生产完整等价性与 F1–F3 继续保持原范围；限流 fail-open、不同路径的空输出/中止计费和跨请求幂等不因观测改造被偷偷改变。

## 历史阶段交付

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
| 数据库权威定义核对（P0b 的定义缺口） | 2026-10-02 获得真实环境只读授权后，已通过 Supabase MCP 获取实际 catalog 与 121 项迁移记录，并与本地 fixture 核对 | 来源缺口已解除；核对发现权限与部署差异，真实环境安全验收仍被阻断，不能据本地通过认定可上线 |
| 真实鉴权与纵向联调（P1/P4） | 已补独立 GoTrue/PostgREST/PG，真实 JWT、Cookie、用户更新、塔罗/BYOK/历史/知识库联调 17/17 通过；模型仍为桩，非完整 Next 浏览器端到端 | 本地授权范围已完成；不代替生产定义、OAuth/邮件或付费供应商验收 |
| 候选代码远程 CI（P7） | 最终代码候选 `a5858822be783d3c6b5b303c017c6faa9dee774e` 已通过 Node 20.20.2＋固定 Chromium 的 [quality run 36990640973](https://github.com/hhszzzz/taibu/actions/runs/36990640973) | 1152 默认测试、20 产物、22 SQL、17 Auth/REST、28 浏览器检查全部通过；只证明该提交与其 fixture，不证明真实环境权限等价 |

数据库权威来源缺口已通过单独授权的只读核对解除；发现的实际权限差异仍阻断真实环境安全验收。自动目标提醒不提供环境访问、代码上传或生产操作授权。生产 SQL 应用、上线及 F1–F3 平台迁移另行授权，不与上述非生产验收混为一项任务。

## 授权续验（进行中）

用户随后通过交互明确选择：

- 允许创建完整临时本地 Auth/PostgREST 测试栈，下载必要 Docker 镜像；不挂载已有数据、不连接生产，完成后清理。
- 最初选择由用户提供数据库导出；后来用户明确改为授权 Supabase MCP 只读核对真实环境。仅读取 catalog/权限/迁移元数据及安全 advisory，不读取业务行、不执行线上写入。
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

**远程证据按 SHA 记录在[草稿 PR #16 的检查与说明](https://github.com/hhszzzz/taibu/pull/16)。** `a585882` 的实际远程结果已确认通过；后续代码变化必须另行验证，不能沿用旧结果。

### 真实数据库权威核对（2026-10-02，只读）

用户后续明确授权 Supabase MCP 访问真实环境，原“等待导出”阻塞已解除。本次只读取系统 catalog、权限、迁移记录和安全 advisory；没有读取业务数据、真实账号凭据，也没有执行 DDL、业务 RPC、生产写入或部署。

- 已取得 42 张 public 表的清单、59 个函数的签名/权限、121 项已应用迁移记录；深入比对本轮 fixture 的 17 张表和 14 个应用函数，包括列/默认值/约束、62 条策略、55 个索引及触发器/视图/默认权限。
- 14 个函数的身份参数、返回类型与 definer 标志一致；11 个正文规范化摘要一致。3 个搜索函数仍为历史定义，本轮两份 October 修复 migration 均未应用。
- 真实库与 fixture 的引擎/扩展、对象 owner、表入口权限、部分字段及 RLS 存在差异。限流 sequence 和唯一键已在真实 catalog 确认，但这不使整个 fixture 成为生产等价基线。
- 权限差异进一步在仅有虚构账号的独立本地栈复现了安全缺口。**因此不能把既有 CI 全绿或“核对已完成”写成真实环境安全通过。** 两份现有函数修复也不足以覆盖全部表权限入口。

为避免将未修复环境的具体权限缺口公开到公共 PR，详细证据与修复顺序保存在本地忽略路径 `.claude/database-authority-review-20261002.md`，不自动上传。该轮仅更新本地文档，未执行生产 migration；后续获批本地修复结果如下。

## 权限修复与后续精简（2026-10-03，本地交付）

用户批准仅在本地实现权限修复及验证；随后要求继续寻找简化、优化项。本轮没有提交、推送、合并、部署或执行真实环境 migration，`a585882` 的旧远程 CI 不能代替此次未提交改动的验证。

### 权限补强

- 新增 `20261002_102000_protect_account_and_ledger_writes.sql`：invoker 触发器保护用户身份与权益字段，restrictive policy 限制普通用户直接插入流水，同时保留管理员 JWT、service_role 和可信 SQL owner 执行路径。保留两份既有 October 修复。
- Fixture 对受影响表使用经核对的宽 CRUD 授权，并确认没有额外 TRUNCATE 能力；拒绝不再依赖缺少表权限。
- 加载现行 Auth profile-sync 函数/绑定，由真实 Auth 创建 profile；补齐激活、签到、月度会员等既有函数及当前并发/超额修订，不整体回放历史 SQL。
- 修复前 SQL 红灯为 29 项中 23 通过、6 失败，包含 5 个真实缺少拒绝的测试组及父项；原有 21 个 SQL 子场景通过。新迁移加载后扩展 SQL **34/34**、真实 Auth/REST **21/21** 通过，前置条件故障也验证原子拒绝。

### 已落实的三项小步精简

1. **公告缓存失效去重**：`requestBrowserData()` 已调用公共失效逻辑，删除公告面板保存/删除后的第二次调用。实际组件浏览器回归修复前观测到 2 次失效；修复后 POST/PATCH/DELETE 各一次，创建/删除失败均不失效。保留必要的面板列表重新加载，不宣称所有网络请求减半。
2. **分析快照请求包装精简**：移除只转发 GET/错误文案的私有重载包装，直接复用 `requestBrowserData()`；详情 404 返回 null、列表失败抛错、空列表不加载详情、AbortError 原样传播都有覆盖。
3. **删除无调用者的 HTTP facade**：移除 `resolveChatRequest()`，保留仍被使用的 `resolveManagedChat()`、`ResolvedChatRequest` 和实际 `prepareChatRequest()` 流程，不合并托管/BYOK 生命周期。

上述三个业务源文件净减少 **42 行**；不是仓库总行数减少承诺。新增回归放在现有测试文件/浏览器 fixture 中，浏览器检查从 28 增为 33。

### 主工作区完整自验

`DOTENV_CONFIG_PATH=/dev/null NEXT_TELEMETRY_DISABLED=1 pnpm verify -- --chrome` **完整通过**：

| 层 | 结果 |
|---|---|
| 包构建、lint/架构守卫、strict | 全部通过 |
| 默认单元/路由/Core/MCP 测试 | **1153/1153，0 fail、0 skip** |
| Next 生产构建 | 通过 |
| 包/许可证/Skill 产物 | **20/20** |
| PostgreSQL/RLS/事务 | **34/34** |
| 真实 Auth/JWT/PostgREST | **21/21** |
| 离线实际浏览器组件 | **33/33**，39 个 fixture 请求，无外部请求或运行时异常 |

主工作区另使用精确 PostgreSQL **17.6** / vector **0.8.0** 运行同一套 Auth/REST 测试，**21/21 通过**，未跳过断言。独立版本断言和测试资源清理均通过。默认 PG16 gate 未被静默替换；精确版本的私有重放入口为 `.claude/verify-pg17-permissions.test.mjs`，先 `pnpm build:core`，再按脚本头部命令运行。镜像缓存保留，不操作其他 Docker 资源。

### 后续候选与明确边界

进一步确认的候选：聊天提示词装配与 KB 命中映射重复读取 KB 名称；提示词预算在同一次装配中重复计算。前者正常命中路径可减少一次元数据查询，但需要保留缺失/失败回退；后者通常只减少一次配置查找，不能说减少数据库请求（现有缓存仍生效）。这两项没有混入本轮改动，后续应单独补查询次数、输出一致性和调用者隔离回归。

**本轮获批的本地修复与自验已完成。** 此阶段结束时尚未应用真实环境迁移或提交新候选；随后独立授权的执行结果如下。历史权限/流水数据可信度未审查，不以修复通过声称历史数据安全。

## 授权数据库修复执行（2026-10-03）

用户单独批准三份修复及验收分支更新/CI。执行前重新核对目标、121 项已应用迁移、函数签名/owner、扩展位置、字段类型/默认值与 RLS 前提，没有发现阻止执行的漂移。仅按以下顺序应用三份原文 SQL，全部成功；没有重放历史清单、读取业务行、回填数据或部署应用。

| 本地迁移 | MCP 实际记录版本 |
|---|---|
| `20261002_100000_fix_knowledge_search_contracts.sql` | `20261003004639` |
| `20261002_101000_restrict_credit_ledger_rpc.sql` | `20261003004844` |
| `20261002_102000_protect_account_and_ledger_writes.sql` | `20261003005536` |

MCP 分配执行时间版本，表中映射不改变本地文件名。执行后只读 catalog 确认三个搜索函数的正文/路径/执行权限、裸流水 RPC 权限、invoker 保护函数及已启用的 BEFORE INSERT/UPDATE 触发器、authenticated 的 RESTRICTIVE INSERT policy 均符合迁移；表 owner、RLS 开启和 FORCE RLS 关闭状态保持不变。

Supabase advisory 仍列出 11 项 anon、40 项 authenticated 可执行 definer 提示，以及泄露密码保护未开启；不是 51 个已确认漏洞，未在本次授权外批量改权限或 Auth 设置。后续逐项评估可参考 [anon advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[authenticated advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) 和 [密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

这证明指定修复已安装，不证明全库无其他问题或历史权益/流水可信。生产负例未执行，行为证据仍来自上述隔离双版本测试。原始 catalog、项目标识、私有复现证据不上传公共 PR。新候选远程 CI 的确切 SHA、结果和部署状态由 [草稿 PR #16](https://github.com/hhszzzz/taibu/pull/16) 记录，不以本地结果替代。
