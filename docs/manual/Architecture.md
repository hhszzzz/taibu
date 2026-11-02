# 项目架构

研发约束与验收规范见 [工程与设计规范](../engineering/README.md)；本文只描述当前架构和运行边界。

## 运行组成

应用使用 Next.js 模块化单体，生产以 standalone 镜像运行。Web 与后台 worker 使用同一镜像，通过 PostgreSQL 和 Redis 协作。

| 组件 | 职责 | 主要入口 |
| --- | --- | --- |
| Web / API | 页面、鉴权、参数和权限检查、流式回复 | `src/app/`、`src/lib/api-utils.ts` |
| PostgreSQL 17 + pgvector | 账号、业务数据、事务、RLS、向量检索 | `database/`、`src/lib/db/` |
| Better Auth | 邮箱、密码、验证码、会话 | `src/lib/identity/`、`identity` schema |
| Redis | 共享缓存、限流、登录失败锁、会话二级存储、BullMQ | `src/lib/redis.server.ts`、`src/lib/jobs/` |
| Worker | Agent 执行、文档处理、邮件与维护任务 | `scripts/agent-worker.mjs`、`src/lib/agent/` |
| 文件卷 | 用户上传的私有文件 | `src/lib/storage/`、`FILE_STORAGE_ROOT` |
| Core | 占术计算、规范文本和 JSON、工具与方法 | `packages/core/` |
| MCP | 将 Core 能力提供为 stdio / HTTP 协议 | `packages/mcp/`、`packages/mcp-server/` |

应用直接连接 PostgreSQL、Redis 和 SMTP；本地 Compose 额外提供 Mailpit。部署、连接配置、备份与 SQL 操作见 [自托管手册](Self-Hosting.md)。

## 模块边界

- Core 不依赖 Web、数据库或认证。Web 和 MCP 复用 Core 的计算与规范输出，算法约定见 `packages/core/ALGORITHM_RULES.md`。
- 路由复用 `api-utils.ts` 的鉴权和响应封装；管理员入口使用 `requireAdminUser()` / `requireAdminContext()`。
- 业务数据通过 `context.server.ts` 的 `userDb()` / `anonDb()` / `systemDb()` 获取 `ScopedDb`，禁止在路由和组件里创建连接池。
- 新模块、接口或表结构先检索已有实现；跨表写入优先复用已有原子函数。

## 数据与权限

`taibu_app` 是 NOINHERIT 应用连接角色。每个受控事务显式设置有效角色和 `request.jwt.claims`，RLS 据此隔离用户数据。缺少用户上下文时直接失败。

后台 `systemDb()` 使用固定系统主体；该主体不能登录，且业务请求不能通过缺少身份回退为系统主体。管理员身份来自数据库账号状态。Better Auth 使用独立的 `taibu_auth` 连接，仅访问 `identity`。

数据库以当前 SQL 为准：`schema.sql` 描述表与约束，`functions.sql` 描述函数与视图，`triggers.sql`、`access.sql`、`indexes.sql` 和 `seed.sql` 分别描述触发器、权限、索引与系统主体/数据不变量。`db:init` 先执行 `migrations/` 中尚未记录的编号迁移（账本 `taibu_meta.schema_migrations` 按校验和防止改动历史），再补齐缺失的表、列与约束，最后把声明对象与 PostgreSQL 反解文本比较，只应用差异，并删除文件不再声明的函数、视图、策略、触发器与索引。删表删列、改类型与回填只通过编号迁移完成，详见 [自托管手册](Self-Hosting.md#数据库)。

安全函数显式固定 `search_path` 与执行权限。余额、订阅、账单流水、兑换码与订单只经 `SECURITY DEFINER` 函数在同一事务中写入，用户只能读自己的行；通知的用户写权限仅允许确认已读。

## 计费

平台模型按实际用量以美元计费，参照 new-api 的订阅与钱包。功能对所有人开放，上限统一；没有会员等级。

- 金额以微美元整数保存（1 美元 = 1,000,000）。模型单价为美元每百万 token（输入、缓存读、缓存写、输出；缓存价留空按输入价）或每张图；单价留空即未定价，平台不提供该模型（`MODEL_UNPRICED`），全为 0 是免费模型。计价函数在 `src/lib/billing/pricing.ts`，单次费用向上取整。
- 账户：`billing_accounts` 是钱包并记扣费顺序，`user_subscriptions` 是订阅，每个订阅按窗口发放额度（`user_subscription_limits`：5 小时 / 每天 / 每周 / 每月 / 整个订阅期，到期前惰性重置；套餐的窗口快照在 `subscription_plan_limits`）。扣费按会员选的顺序（先订阅或先余额），先订阅时窗口从短到长扣；`billing_ledger` 每次一条流水，记来源、模型、四类 token、资金来源与幂等键；免费模型与自定义模型的调用同样记一条 $0 流水，后者在 `usage.byok` 标记。
- 准入与结算：对话、照片解读、润色调用前要求可用额度大于 0（402 `INSUFFICIENT_BALANCE`），结束后按上游用量入账，拿不到用量时按提示词与已产出文字估算并标 `estimated`；入账允许把钱包扣成小额负数。Agent 每次模型请求前后各做一次，见 [Agent 手册](Agent.md)。生图价格已知，预扣全额且不许欠费，没出的图退回。免费模型照样记 $0 流水。
- 自定义模型（BYOK）：会员在「设置 → 自定义模型」添加连接（OpenAI 兼容或 Anthropic Messages），每个连接下若干模型，每个模型用于对话或生图；存于 `user_ai_connections` / `user_ai_models`，对话、任务与预设以 `byok:<模型行 ID>` 引用。对话请求统一经 pi-ai 发出，不带 temperature，努力程度按模型档位换成各协议的参数。Key 默认只存在这台设备（localStorage，按账户分开，退出登录清除），由浏览器直连服务商：对话与照片解读先由本站准备提示词（`direct-prepare`），结果经 `direct-persist` 保存，生成的图片经 `/api/images/upload` 交给本站保存，用量经 `/api/chat/direct/usage` 回报。连接打开「保存到本站」后，Key 由 `AGENT_CREDENTIAL_ENCRYPTION_KEY` 派生的子密钥加密存库，绑定账户、连接与域名，只写不回显（页面只见 `sk-…abcd`），请求由本站经 `agentSafeFetch` 代发（只允许公开 HTTPS 地址、不跟随重定向），这样的模型也能用于定时任务。管理员在「AI 服务 → 自定义模型」设置每人连接数、每个连接的模型数与「允许保存到本站」；关闭后已保存的 Key 保留但暂停使用。功能开关 `byok` 关闭时入口与接口一并关闭。自定义模型不计费，每次调用记 $0 流水。代码在 `src/lib/byok/`，接口在 `src/app/api/byok/`。
- 充值：兑换码（余额码或套餐码）、管理员加减余额与赠送订阅、用余额买套餐始终可用。易支付（支付宝/微信）在 `EPAY_API_URL`、`EPAY_PID`、`EPAY_KEY` 齐全时开启：下单生成待支付订单与签名表单，异步通知验签、核对金额后由 `payment_order_complete` 幂等入账。`billing-maintenance` 每 10 分钟处理到期订阅与超时订单。
- 查看：用户在「钱包」看余额、订阅、套餐、充值、兑换码与支付订单；在「用量日志」按来源/模型/类型/时间筛选流水，上方是消费合计与按模型汇总，点开一条看详情：用量、按扣费时单价逐项列出的计费明细与扣费来源。扣费时把单价快照写进 `usage.prices`，此前的记录没有快照，只显示合计。管理员在「计费」管理用户账户、套餐、兑换码、订单与设置（加减余额以管理员本人的身份调用，流水的关联记下这位操作人），在「日志」查看全站用量日志（全部流水类型，合计只算调用与退回）、Agent 任务与定时任务运行记录。自定义模型的调用以 $0 记入，浏览器直连的用量由浏览器回报。功能开关把「钱包」与「用量日志」分开：关闭钱包后用量日志照常可用，账户菜单保留它的入口。

代码在 `src/lib/billing/`（数据库查询辅助在 `src/lib/db/billing-queries.ts`），路由在 `src/app/api/billing/` 与 `src/app/api/admin/billing/`，余额准入的统一响应在 `src/lib/api/balance-guard.ts`。

## AI 与 Agent

各占术结果页不再在页内生成解读，统一由 AI 对话处理；仍保留的一次性解读（面相/手相照片解读）复用 `src/lib/api/divination-pipeline.ts`：资源归属、模型定价准入、余额准入、限流、模型调用与按用量入账、原子持久化按现有用例执行。来源在 `src/lib/source-contracts.ts` 注册，保存复用 `createAIAnalysisConversation`。

Agent 由后台 worker 执行 Pi Durable checkpoint。任务、租约与 fence、命令、工具产物和结算状态保存在 PostgreSQL；恢复执行必须持有有效租约，幂等收据避免重复落库。运行状态、用户主动保存和 BYOK 边界见 [Agent 手册](Agent.md)。

文档解析在 worker 线程中执行。知识库检索绑定所有者，向量与文本检索复用已有数据访问层；文件访问使用受控接口，私有附件按引用关系回收。

## 验证入口

- `pnpm lint`：代码检查与架构边界。
- `pnpm test`：单元、路由、协议与守卫测试，自动构建所需包。
- `pnpm test:db`：隔离 PostgreSQL 中验证当前 SQL、RLS、并发与原子性。
- `pnpm test:auth`：本地栈中的 Better Auth 与邮件验收。
- `pnpm test:browser`：真实浏览器组件行为。
- `pnpm typecheck`、`pnpm build`：类型与生产构建。
- `pnpm verify`：统一执行完整验收，需要 Docker 与已安装的 Playwright 浏览器。
