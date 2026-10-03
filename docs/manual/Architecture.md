# 架构与迁移边界

本文面向维护者，说明当前代码的职责、兼容例外和验收边界。它不是 P0–P7 完成报告，也不表示生产环境已经迁移、发布或完成验证。具体测试数量、构建结果和数据库变更状态见 [本轮验收记录](Refactor-Acceptance.md)。

## 1. 总体方向：模块化单体，而不是重建平台

Web 继续使用 Next.js/React；计算内核、stdio MCP 和 HTTP MCP 保持现有包边界。浏览器通过受控 HTTP 接口访问应用服务；应用用例接收已授权身份、普通数据和窄操作；Supabase、SQL RPC、模型 SDK 等细节由服务端适配层持有。

本轮不引入微服务、全局事件总线、依赖注入容器、通用仓储基类或第二套认证系统，也不合并占术表。已有 Docker 配置不等于完成生产容器化，更不等于已经退出 Vercel 或 Supabase。

| 职责 | 当前主要入口 | 边界 |
| --- | --- | --- |
| 页面和交互 | `src/app`、`src/components` | 负责展示、输入和交互；业务规则不应继续堆入页面 |
| HTTP/身份装配 | `src/lib/api-utils.ts`、`src/lib/api/divination-pipeline.ts`、`src/lib/server/chat/request.ts` | 解析、鉴权、受控客户端装配、JSON/SSE 映射；旧工厂仍有 SDK 和准入装配职责 |
| 聊天准备用例 | `src/lib/server/chat/contracts.ts`、`use-case.ts` | 普通身份/输入与窄操作；不接收 NextRequest、Response 或 Supabase 查询构造器 |
| 占术分析用例 | `src/lib/server/analysis.ts` | 提示词准备、完成分类、保存与退款结果；不承担所有路由鉴权或模型 SDK 调用 |
| 业务来源与数据 | `src/lib/source-contracts.ts`、`src/lib/data-sources`、`src/lib/history` | 三者各自负责来源契约、加载/格式化和历史回放，不合成万能注册中心 |
| 知识库 | `src/lib/knowledge-base` | 入库/检索、纯来源替换用例、受控持久化适配 |
| 浏览器状态 | `src/lib/hooks/session-context.tsx`、`src/lib/query`、`src/lib/chat` | 会话快照、服务端缓存、聊天流任务分别拥有状态 |
| 计算与规范输出 | `packages/core` | 不依赖 Web 账号、会员、积分或数据库 |
| MCP 接入 | `packages/mcp`、`packages/mcp-server` | 复用 Core 工具 manifest、schema、算法及规范输出 |

新边界应使用普通函数注入，不另建系统级容器。不是所有 `src/lib` 文件都可在浏览器导入：服务器实现应有 `server-only` 边界；`.server.ts` 类型合约只允许 `import type`，不能通过桶导出把服务器实现带入浏览器。

依据：[聊天合约](../../src/lib/server/chat/contracts.ts)、[聊天用例](../../src/lib/server/chat/use-case.ts)、[分析用例](../../src/lib/server/analysis.ts)；对应[聊天测试](../../src/tests/chat-use-case.test.ts)、[分析测试](../../src/tests/analysis-use-case.test.ts)。

## 2. 包名、规范输出与三种来源

### 2.1 以当前公开导出为准

仓库当前包名是 `taibu-core`、`taibu-mcp`、`taibu-mcp-server`。旧资料中的 `@mingai/*` 名称，以及 `@mingai/core/text`、`@mingai/core/json` 导入方式，不应作为新增代码的 API 依据。

Core 通过领域子路径公开规范格式化函数，例如：

- `taibu-core/bazi`：`toBaziText()`、`toBaziJson()`。
- `taibu-core/tarot`：`toTarotText()`、`toTarotJson()`。
- `taibu-core/mcp`：`executeTool()`、`renderToolResult()` 等工具适配。

实现内部仍可使用 `render*CanonicalText/JSON` 命名，但 Web/MCP 消费方应复用公开导出，不能访问 Core 的 `src`/`dist` 内部路径，或另写一份占术文本格式化。Web 的输入转换、产品规则和展示适配仍可留在 `src/lib/divination`。

依据：[Core 包定义](../../packages/core/package.json)、[公开 API 说明](../../packages/core/README.md)、[塔罗领域导出](../../packages/core/src/domains/tarot/index.ts)、[跨结果/来源格式测试](../../src/tests/result-data-source-format-consistency.test.ts)。

### 2.2 三种 source 不能混用

| 概念 | 权威位置 | 示例与职责 |
| --- | --- | --- |
| 会话/分析业务来源 | `src/lib/source-contracts.ts` | `tarot`、`bazi_wuxing` 等；来源数据、模型/推理字段及使用统计映射。旧 `ai/source-contract.ts` 已合入此文件 |
| 可提及/归档的数据源 | `src/lib/data-sources/types.ts`、`catalog.ts`、`manifest.ts` | `tarot_reading`、`ming_record` 等；DTO、目录、加载与格式化。浏览器目录不依赖 SupabaseClient |
| AI 模型网关来源 | `src/lib/ai/source-runtime.ts` 等 | 网关绑定、优先级、启停、路由模式和模型覆盖，不代表用户业务资料 |

服务器数据提供者及 `DataSourceQueryContext` 位于 `data-sources/provider.server.ts`；其 SDK 类型不再从浏览器 DTO 文件导出。`manifest.ts` 负责服务器提供者加载，不是浏览器目录入口。

模型来源的兼容规则也有明确边界：**非空配置列表具有权威性**。全部禁用、配置不完整或固定路由过滤后为空，不能借旧字段自动恢复来源；没有列表或列表为空的旧配置才可能回退，并且仍须满足旧 URL/key 和固定路由条件。返回 SDK 流对象不等于流式故障切换已经成功；输出后的付费调用不应自动重试。

依据：[业务来源契约](../../src/lib/source-contracts.ts)、[数据源合约](../../src/lib/data-sources/provider.server.ts)、[来源选择实现](../../src/lib/ai/source-runtime.ts)、[浏览器边界测试](../../src/tests/data-source-boundaries.test.ts)。

## 3. 身份与持久化：授权不是一个 userId

### 3.1 应用身份和数据库角色分开

- 用户接口通过 `requireUserContext()` 或明确要求 Bearer 的受控入口鉴权；管理员接口使用 `requireAdminUser()` / `requireAdminContext()`。
- 新用例接收最小应用身份，而不是 Supabase User、请求对象或凭据。受信任的绕过计费策略只能由服务端入口授予，不能相信请求体中的标志。
- `getSystemAdminClient()` 实际使用 **anon key + 系统管理员登录会话 JWT**。它不是无限制的 `service_role` 连接，仍受 RLS、管理员 policy 和 RPC 权限约束。旧注释中的“绕过 RLS”不能视为真实权限保证。
- `getAuthAdminClient()` 是独立的 Auth 管理入口；不能拿它替代用户数据客户端。
- `createAuthedClient(token)` 只绑定请求头，适合 PostgREST/RLS，不代表 Auth SDK 已保存会话。需要 SDK 会话的用户资料更新使用 `createSessionClient()`，仅接受服务端已验证的会话，每个请求独享内存存储；Cookie 刷新后即使更新被拒绝也保留新凭据。普通登出用匿名客户端的 `auth.admin.signOut(verifiedJwt, 'global')` 发送调用者 JWT，不取得管理员权限；它撤销 refresh session，已签发 access JWT 仍可能有效至到期。
- 缺失用户态上下文必须失败，不能为了兼容改用系统管理员。鉴权安全纠错和机械提取应独立验证；“接口已经迁到用例”不能证明权限边界已经通过测试。

依据：[API 鉴权入口](../../src/lib/api-utils.ts)、[系统管理员客户端实现](../../src/lib/supabase-server.ts)、[会话鉴权测试](../../src/tests/api-utils-auth-session.test.ts)。

### 3.2 窄操作对应现有 SQL 事务

保留积分/流水、会话 JSON/规范消息行、分析/历史绑定、知识块替换/归档等已有原子边界。不应把一个 RPC 拆成多次独立写请求，也不应把所有领域包装成 `query(table)`。

分析结果继续通过 `createAIAnalysisConversation()` 写入；带历史绑定时复用 `create_analysis_conversation_with_history_as_service`，无绑定时使用现有会话事务。普通聊天仍由浏览器通过会话接口发起保存，不因此改成服务器分析保存模式。

SQL 原子性只覆盖该事务，不覆盖模型调用、浏览器传输和所有后置 hook。尤其 `persistRecord` 等兼容回调可能在主事务成功后失败：收到错误并不必然表示数据库没有写入，不能盲目重复保存或重新收费。

AI 请求入口生成可信的请求 ID，并向纯观测器注入时钟及日志接收函数。日志仅记录 source、阶段、耗时、限定失败分类，以及生成/持久化/计费状态；终态在已观察到的保存和补偿结束后记录一次，日志接收函数失败不影响业务。退款返回 false 与抛异常分开标记，不记录原始供应商错误、提示词、输出或凭据。BYOK prepare/persist 分属独立请求，浏览器生成标记为外部、不可由服务器证明；延迟流转换失败只补记录，不借日志改造改变原计费政策。

依据：[分析持久化](../../src/lib/ai/ai-analysis.ts)、[工厂保存装配](../../src/lib/api/divination-pipeline.ts)、[分析保存测试](../../src/tests/conversation-analysis.test.ts)。

### 3.3 知识库的调用者边界

- `source-replacement.ts` 只处理普通数据：来源必须一致，`chunkIndex` 必须从 0 连续递增；显式来源允许空块数组，以清空已有来源内容。
- `KnowledgeSourcePersistence.replaceSourceEntries()` 同时表达替换和可选归档。适配器只调用一次 `kb_replace_source_entries`，不分别删除、插入和归档。
- `persistence.server.ts` 的 `createKnowledgeBasePersistence(client)` 由调用方绑定身份；适配器不自行升级权限。
- 用户 ingest/upload 路由完成鉴权、会员与知识库归属检查后，将请求数据库客户端绑定为窄 `IngestOptions.persistence`。五个 service 入库 facade 传递此端口；不向纯用例传原始 SDK 对象。
- 用户搜索和权重查询使用调用者 access token。只有 `userId` 不构成读权限；缺少 token 时拒绝搜索，HTTP 搜索入口返回受控错误。免费会员的无读取短路仍保留。
- 旧内部 service facade 的默认客户端、带归属条件的来源读取，以及显式特权向量回填仍是兼容例外，不能照搬到新增用户请求路径。

检索失败与无命中分开处理：适配器显式传播 RPC 错误，全文/相似/向量阶段可独立降级；成功阶段的候选保留，所有已执行阶段失败则明确报错，不把调用者身份缺失转为空结果。权重扩展与 rerank 失败仍保留已有候选。向量距离 `0` 作为精确命中保留，只有缺失距离才采用默认值。请求内已读取的 KB 名称仅按同一调用者复用，缺失项保留受控回退，不跨账号缓存名称。

依据：[来源替换用例](../../src/lib/knowledge-base/source-replacement.ts)、[适配器](../../src/lib/knowledge-base/persistence.server.ts)、[检索](../../src/lib/knowledge-base/search.ts)、[原子委托测试](../../src/tests/knowledge-base-persistence.test.ts)、[调用者身份测试](../../src/tests/knowledge-base-caller-identity.test.ts)。

## 4. 浏览器状态的唯一责任方

| 状态 | 责任方 | 不做什么 |
| --- | --- | --- |
| 当前会话快照 | `hooks/session-context.tsx`；Provider 负责装配和订阅 | 基础 hooks 不反向依赖 `ClientProviders` 组件 |
| 会话列表服务器数据 | Query cache，按用户键隔离 | Context 不再另存一份可写列表 |
| 列表窗口及请求协调 | `ConversationListContext` | 保留旧消费者 API，但 ref 访问的是同一 Query 数据 |
| 当前选中会话 | `chat/use-chat-state.ts` 的页面状态 | 不把选择状态当作服务器列表缓存 |
| 设置 mutation 副作用 | `query/invalidation.ts` 中显式 effects | 已迁移操作不同时再走 URL 推断，避免重复失效 |
| 面板、子标签和表单 | 设置中心及领域管理面板 | 拆组件不改变 hash/subpath、keep-alive 或权限行为 |
| 跨页面聊天流任务 | `ChatStreamManager` | 不用页面级 hook 替代其跨路由存活语义 |
| 占术页面生成 | `useStreamingResponse` + `runSharedAnalysisFlow` | 不自动获得持久后台任务语义 |

“后台聊天”只指当前浏览器会话中的跨页面任务。关闭页面、浏览器重启或进程故障后继续执行，不是本轮承诺。账号切换既要隔离 Query key，也要防止旧请求写回新账号的列表；不能只清空显示层。

旧 DOM 事件、URL 推断失效仍服务未迁移消费者。新增操作优先使用显式 effects；最后一个消费者迁移并验证后才能移除旧分支，而不是增加新事件总线。

设置保活的边界是“账号＋标签页”。同账号会话刷新不重置草稿，换账号/卸载取消旧请求及副作用；保存成功只推进已保存基线，不覆盖保存期间的新编辑。设置与提醒客户端可携带 `X-Expected-User-Id`，服务器在认证后、访问数据前检查一致性，不匹配返回 `409`。该值不是鉴权凭据，数据库归属仍来自已认证用户；旧客户端不带该值仍兼容。

会话乐观操作由同一 Query 缓存中的按 ID 操作记录协调：同 ID 请求不交错，不同 ID 可并发；失败只回滚目标字段或条目，刷新合并待确认操作。刷新/分页接管时替换整个加载模式，过期响应不得写回或复活已删除条目。模型面板同样保留脏字段，旧重叠读取不能覆盖新结果。

依据：[会话上下文](../../src/lib/hooks/session-context.tsx)、[列表缓存](../../src/lib/query/conversation-list-cache.ts)、[失效策略](../../src/lib/query/invalidation.ts)、[管理面板装配](../../src/components/settings/AccountAdminPanels.tsx)；对应[列表缓存测试](../../src/tests/conversation-list-cache.test.ts)、[mutation 测试](../../src/tests/query-mutation-effects.test.ts)、[聊天任务测试](../../src/tests/chat-stream-manager.test.ts)。

## 5. AI 生命周期矩阵

### 5.1 先区分三种状态

一次请求的**生成、保存、计费**必须分别描述。例如“已有文本”不代表保存成功，“发送 finish”不代表退款已结清，“浏览器停止读取”也不等于模型已停止执行。

公共托管入口的准入规范是会员 → 积分校验/扣减 → 限流。实际扣款后遇到限流拒绝或**传播到用例的异常**，会补偿该笔扣款且不调用模型；退款失败返回 `CREDIT_REFUND_FAILED`。默认按用户 ID + 端点路径限制为 20 次/60 秒；八字、紫微保留原 IP + 固定端点的 10 次/60 秒覆盖策略，不重复限流。BYOK prepare 校验账号后限流，不要求平台模型权限或正积分余额；persist/save 不重复执行准入。

**保留的例外：** 底层 `rate-limit.ts` 仍将自身捕获的 RPC/连接失败转为 `allowed: true`（fail-open）。这类错误不会传播到用例，因此不会触发上述异常补偿，而是继续执行。当前改造没有把限流改成 fail-closed；不可将异常注入测试解释为所有限流数据库故障都会拒绝请求。

`createManagedAnalysisCompletion()` 为单个已扣款请求的正常完成路径保存一个终态 Promise，避免竞争回调重复保存/退款。它不是跨请求、跨进程或所有适配器异常的 exactly-once 保证，也没有新增持久任务表或全局幂等键。

### 5.2 当前行为，而非统一后的理想规则

“尝试退款”不等于已经退款成功；下表的成功、失败、停止与无正文是不同终态。

| 路径/情况 | 执行与保存 | 平台计费/补偿 |
| --- | --- | --- |
| 托管聊天：正常流，有正文 | 服务端调用模型；浏览器任务管理器通过会话 API 保存，保留版本处理 | 普通登录用户预扣；有正文保留收费 |
| 托管聊天：只有 reasoning 或空正文 | 服务端 finish 检查可见 text；浏览器可保存 reasoning，完全无正文且无 reasoning 则失败 | finish 回调无可见正文时尝试退款；浏览器保存与服务端收费判断不是同一个条件 |
| 托管聊天：停止/读取失败，已有部分输出 | 浏览器保留并尝试保存部分正文或 reasoning；仅 metadata 不保存 | 不因前端停止自动退款；服务端以实际 finish/错误路径为准，有可见正文后失败保留收费 |
| 托管聊天：非流式 | 路由返回 content/metadata；保存仍不属于分析工厂 | 已预扣；原非流式空字符串没有流式空正文退款规则；进入路由 catch 的调用异常尝试退款 |
| 托管占术：文本/流式正常正文 | 用例保存分析；带历史绑定时使用原子事务 | 保存成功保留收费；流式正常 finish 等待保存完成 |
| 托管占术：文本/流式空正文，包括仅 reasoning | 不保存；返回错误；流式错误先于 finish | 尝试退款，区分 refunded/refund-failed |
| 托管占术：非中止流，部分正文且 finishReason 为 error | 保留现有行为：仍进入保存路径，不能把 finishReason 单独当作“未保存” | 保存成功保留收费 |
| 托管占术：SDK 明确报告 isAborted | 不提交该流的部分分析；不按正常完成发送 finish | 保留原收费，不自动退款 |
| 托管占术：推理或保存失败 | 不报告“成功保存”；主事务与后置 hook 的失败需区分 | 尝试退款；退款失败必须可观测，不能由 UI 成功状态覆盖 |
| 托管视觉占术：空输出 | 旧规则仍允许进入保存，并保留视觉非流式响应形状 | 保留原收费；尚未统一成文本空结果策略 |
| BYOK 聊天 | 浏览器直连供应商，沿用聊天任务/会话保存语义 | 不扣平台模型积分；供应商自身费用不由平台退款逻辑控制 |
| BYOK 占术：正常/停止后有正文 | prepare → 浏览器直连 → 独立 persist；当前直接流的 AbortError 返回累积内容，未标 error 时仍会尝试 persist | 无平台扣费；停止后部分正文不等于“一定不保存” |
| BYOK 占术：直连返回 error、空正文或保存失败 | 直连 error 不进入 persist；空正文 persist 拒绝；保存失败保留可见内容但无成功 conversationId | 无平台退款流程，不伪装成托管完成 |

网络断开与 SDK `isAborted` 不是同一概念。服务器是否收到中止、finish 回调是否执行、供应商是否继续工作，都受实际传输生命周期影响。不能承诺关掉页面就取消上游工作、免除供应商费用或自动完成退款。

BYOK 的 prepare/persist 不传供应商密钥。persist 仍需重新鉴权、解析输入和解析授权上下文，但不会重跑 prepare 的所有 precheck 或重新构建提示词；它接收的是用户提交内容，模型标识也不是模型执行证明。没有新增签名回执或持久任务协议；各入口的资源归属、输入/输出大小边界仍须独立审查。

依据：[聊天路由](../../src/app/api/chat/route.ts)、[聊天任务终态](../../src/lib/chat/chat-stream-manager.ts)、[分析用例](../../src/lib/server/analysis.ts)、[占术工厂](../../src/lib/api/divination-pipeline.ts)、[BYOK 流程](../../src/lib/ai/direct-analysis-client.ts)、[直接流中止](../../src/lib/hooks/useStreamingResponse.ts)；对应[聊天路由测试](../../src/tests/chat-route.test.ts)、[分析用例测试](../../src/tests/analysis-use-case.test.ts)、[工厂流与持久化测试](../../src/tests/divination-pipeline-shared.test.ts)。

## 6. 历史回放不是一种统一算法

`history/registry.ts` 的 replay 元数据只描述现有“历史记录 → 结果页”路径。它不是数据库迁移，也不是数据提供者的格式化策略。

| 历史类型 | 当前回放 | 旧数据规则 |
| --- | --- | --- |
| 奇门 | 用保存的日期、时间、时区与排盘设置重新计算；历史 payload 不使用保存的 output/result_data | 缺失时区等字段继续使用原默认值；不更改同步 TZ 计算区域 |
| 六爻 | 从卦码、动爻、用神目标和保存时间重建输入，结果页计算分析 | 保留原目标过滤/缺省规则；不会因为存在 result_data 就改为原样回放 |
| 梅花 | 优先使用保存的 result_data bundle | 缺少结果但有 input_data 时保留重算 fallback；两者都没有则不可恢复结果 |
| 小六壬 | 使用保存的 result_data bundle | 不照搬梅花的 input_data 重算 fallback |
| 合盘 | 优先使用 result_data | 缺少结果时继续按旧输入重算 |
| 塔罗 | 保存的牌面、方向、牌阵标识与 metadata | 保留 seed、birthDate/numerology 和原缺省；不重新抽牌 |
| 大六壬 | 保存的日期与 settings 作为结果页重算输入 | 保留原时间/时区缺省 |
| MBTI、面相、手相 | 恢复已有字段和记录/会话引用 | 按原字段默认值恢复，不捏造新计算结果 |

没有算法版本号的历史记录不能批量标成当前版本。固定时区、时间、seed、detailLevel 和中文规范输出都是独立的兼容维度；未来改算法必须单独决定旧数据回放策略。奇门内核中修改 `process.env.TZ` 到恢复环境的同步区域禁止插入 `await`。

依据：[历史 registry](../../src/lib/history/registry.ts)、[回放特征测试](../../src/tests/history-replay-policy.test.ts)、[结果格式一致性测试](../../src/tests/result-data-source-format-consistency.test.ts)、[奇门计算边界](../../packages/core/src/domains/qimen/calculate.ts)。

## 7. 保留的 facade 与迁移例外

新增纯用例和 DTO 的依赖守卫使用 TypeScript AST 与模块解析，跟踪别名、相对导入、重导出、类型引用及字面量动态导入的传递路径；不能通过中间模块绕过 HTTP/SDK/Node/环境边界。既有适配器使用明确路径例外，例外只允许其作为装配入口，不允许纯用例引用它。该检查不是任意动态 JavaScript 的完整静态证明，仍需类型、行为测试与代码评审。

例外意味着边界尚未完全迁移，不意味着新增代码可以继续扩散同样依赖。删除兼容层需要证据，不以“已经新建用例文件”为条件。

| 保留对象 | 为什么还在 | 删除/进一步迁移条件 |
| --- | --- | --- |
| `auth.ts` 门面及 Provider 的兼容 hook 导出 | 服务现有消费者；基础 session context 已单独归属 | 确认无调用者，且登录、刷新、退出、账号切换回归通过 |
| `prepareChatRequest` 和聊天 request/prompt 适配 | 对接 HTTP、账号/模型配置、SDK 和旧响应 | 所有调用者改用明确输入/输出后逐步收窄；不能跳过服务器可信策略或重复扣费 |
| `createInterpretHandler` / `createDirectInterpretHandlers` | 多占术入口共享稳定协议；托管和 BYOK 生命周期不同 | 每个领域有成功/失败/权限/历史覆盖，且新用例接管对应责任后再移除旧回调 |
| `createAIAnalysisConversation` 及 SQL 事务 | 保持分析/历史、消息 JSON/规范行的原子保存 | 替代操作具备真实数据库事务、权限和旧数据测试；不得拆散 RPC |
| `ConversationListContext` 的 setter/ref API | 旧流控制器仍依赖，内部已指向单一 Query 缓存 | 最后调用者迁移后删除 API；不能同时恢复第二份数组 |
| `browser-api` URL 推断/DOM 事件 | 尚未迁移的缓存与页面消费者 | 一个 mutation 一次副作用；全消费者改用显式策略并回归后删除旧分支 |
| provider/service 默认管理员客户端 | 部分旧来源读取、内部任务、向量回填仍依赖当前平台身份 | 用经授权的窄读写端口逐域替换，并验证 RLS/RPC；用户路径不得因缺失上下文回退 |
| Web 领域适配与 Core 规范渲染封装 | 输入、产品交互和展示不等同纯计算 | 固定输入/规范输出一致、运行时和许可证边界核对后才能搬移 |
| 会话 JSON、规范消息行及旧历史结构 | 老数据与回放读取路径仍存在 | 回填、双读/兼容观察、约束和回滚方案完成后再移除；本轮不统一结果表 |

## 8. 验证范围与平台限制

验收需要分层记录，而不是只写“测试通过”：

1. **工程检查**：类型、lint、架构守卫、受影响测试；完整构建/包产物验证另记结果。修复测试类型错误不等于业务流程验证通过，也不能靠排除测试或放宽 strict 获得通过。
2. **用例/HTTP/SSE**：成功、鉴权/归属拒绝、空输出、部分输出、reasoning-only、中止、保存失败、退款失败，以及最终事件顺序。
3. **真实隔离数据库**：SQL 函数、RLS、授权、事务、并发和回滚。参见 [数据库复现说明](../../supabase/README.md)。带模拟 claims 的 PostgreSQL/pgvector fixture 是实际 SQL 引擎测试，但不是 Supabase Auth、PostgREST、Cookie/OAuth 或已部署服务测试。
4. **真实 Auth/REST 链路**：`pnpm test:auth` 在临时 GoTrue/PostgREST/PG 中验证 Cookie/JWT/刷新/登出、用户更新和塔罗/历史/KB 链路；只有模型推理是桩。调用实际路由处理器和受限 HTTP adapter，不代表完整 Next 页面端到端、OAuth、邮件或生产 schema 等价。
5. **浏览器旅程**：账号切换、聊天切页/停止/保存失败、历史恢复/归档/检索、设置 hash/返回/keep-alive；API mock 不能替代这些交互验证。
6. **发布/生产**：本地通过、存在 migration 或 Docker 配置，不代表已经执行生产迁移。`20261002` 的本轮数据库纠错应按各自记录区分“仅本地验证”和“已部署”。

仍依赖 Supabase Auth、客户端协议、PostgreSQL/RLS/RPC 及现有存储。将 SDK 移入适配器并不意味着可以直接切换数据库。缺失的完整平台验证、跨进程幂等、流式供应商故障恢复、财务对账和持久任务能力，不能由内存状态或 mock 替代。

Core/MCP 三个包是 MIT；其余 Web、服务端、部署及运行时代码是 AGPL-3.0-only。未来把 Web 实现移入 Core 前必须检查版权和依赖许可，不能通过移动文件默认改变许可证。

### 测试职责与执行入口

| 责任层 | 保留的验证 | 不重复承担 |
| --- | --- | --- |
| 纯用例 | 完整失败/退款组合、单请求终态和窄操作契约 | HTTP 状态码、SDK 构造 |
| 共享 HTTP/SSE 适配 | 每种响应映射、各传输模式接线、鉴权与凭据传播 | 在每种模式穷举同一业务组合 |
| 领域路由 | 参数、资源归属、领域提示词和 source/history 绑定 | 重新证明共享用例的全部状态机 |
| PostgreSQL | RLS、执行权限、并发、真实原子回滚 | 用 Mock 成功冒充 SQL 原子性 |
| Auth/PostgREST | 真实登录/JWT/SDK 会话与数据库角色、纵向业务链路 | 生产定义、OAuth/邮件、完整浏览器 UI |
| 浏览器组件 | hash/Back、保活、账号隔离、流任务、受控表单 | 匹配某个具体变量名或源码表达式 |

移除测试前必须明确保留的覆盖责任方；不能仅以“文件太多”为理由删除安全回归。`route-mock.ts` 只提供显式的单项能力，不再保留无人使用、默认全部成功的旧装配器。模块依赖规则留在架构守卫；需要验证交互的源码拼写断言逐步迁至真实行为测试。

`pnpm test -- <测试文件或目录>` 显式选取测试并构建所需包；不基于 Git 状态猜测影响范围。`pnpm test` 保留完整默认单元/路由/协议层。`pnpm verify` 按顺序构建每个包一次，再执行 lint、strict、默认测试、Next 构建、产物/许可证/Skill、真实 SQL、Auth/PostgREST 和离线浏览器组件验收，失败立即停止。独立 `build`/`typecheck`/产物命令仍自行构建，防止旧 dist 假通过。

浏览器层使用固定的 Playwright 开发依赖与已有 fixture，不引入第二套断言框架。CI 安装固定 Chromium 并强制运行；本机可以显式 `--chrome` 使用已有 Chrome，但不减少断言或静默跳过该层。组件 fixture 的身份/HTTP/模型仍是桩，不能代替真实登录和 PostgREST 联调。

## 9. 回滚边界与维护规则

| 变更 | 回滚方式与限制 |
| --- | --- |
| 用例/适配器抽取 | 保持原 HTTP/DTO/facade，以领域为单位恢复委托；不要同时改变结果格式和数据库布局 |
| 身份、会员、积分与限流纠错 | 与结构抽取分开；不得为了回滚重新开放管理员 fallback 或忽略已扣费补偿。必要时关闭受影响入口，而非退回不安全路径 |
| 模型来源选择 | 保留非空列表的启停权威性；回滚不能把显式禁用来源重新启用 |
| Query/面板迁移 | 按 mutation/领域回退；保持账号隔离、单一缓存责任方和设置路由协议 |
| 历史/规范输出 | 原表、原字段与原回放策略保持兼容；算法变更和旧版本回放另行决策 |
| SQL、RLS、RPC | 先隔离验证和审批，再执行迁移；生产不使用删数据式 down migration，优先经审查的前向修复 |
| 平台替换 | 独立规划身份、数据、文件、订阅和回滚对账；新平台已经写入后不能只切回旧连接串 |

新增功能仍须遵守现有安全规范：API 使用受控鉴权/响应工具，管理员接口独立校验，服务器密钥不进入客户端，数据库结构变更提供 migration 并评估 RLS/索引/默认值/旧数据，页面错误使用 Toast，不自行实现 Core 规范文本。涉及真实服务器、生产数据、迁移、发布或凭据的操作必须另获授权；本文不提供或扩大操作权限。
