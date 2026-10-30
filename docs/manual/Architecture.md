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

数据库直接维护当前 SQL：`schema.sql` 描述表与约束，`functions.sql` 描述函数与视图，`triggers.sql`、`access.sql`、`indexes.sql` 和 `seed.sql` 分别描述触发器、权限、索引与系统主体/数据不变量。没有编号迁移、校验账本或历史 SQL 重放。`db:init` 把声明对象与 PostgreSQL 反解文本比较，只应用差异，并删除文件不再声明的函数、视图、策略、触发器与索引；表与列的结构调整仍由维护者执行明确的 SQL，不能靠重跑建表文件完成。

安全函数显式固定 `search_path` 与执行权限。积分、会员和账本写入由数据库事务共同约束；通知的用户写权限仅允许确认已读。

## AI 与 Agent

各占术结果页不再在页内生成解读，统一由 AI 对话处理；仍保留的一次性解读（面相/手相照片解读）复用 `src/lib/api/divination-pipeline.ts`：资源归属、会员与模型权限、积分、限流、模型调用、原子持久化及失败补偿按现有用例执行。来源在 `src/lib/source-contracts.ts` 注册，保存复用 `createAIAnalysisConversation`。

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
