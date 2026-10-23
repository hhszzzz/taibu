# CLAUDE.md

Codex will review your code from three dimensions: maintainability, boundary conditions, and regression risk, and the quality of your code will determine whether the system can go live. Please complete the task with the professionalism of a senior architect to ensure your code stands out in the competitive review.

## ace-tool MCP 工具使用指南

### 核心原则
**任何需要理解代码上下文、探索性搜索、或自然语言定位代码的场景，优先使用 ace-tool**

### 使用场景

#### 1️⃣ 必须用 ace-tool
- 探索性搜索（不确定代码在哪个文件/目录）
- 用自然语言描述要找的逻辑（如"XX部署流程"、"XX事件处理"）
- 理解业务逻辑和调用链路
- 跨模块、跨层级查询（如从 router 追到 service 到 model）
- 新任务开始前的代码调研和架构理解
- 中文语义搜索（工具支持中英文双语查询）

## 常用命令

```bash
pnpm install
pnpm build          # 构建 packages/core + Next.js
pnpm build:packages # 构建 core、mcp、mcp-server
pnpm typecheck      # 构建三个包后进行根 strict 类型检查
pnpm lint
pnpm test           # 构建所需 packages 后跑默认单元/路由/协议测试
pnpm test -- src/tests/chat-route.test.ts # 只运行指定文件，自动构建 Core
pnpm test:db        # 独立本地 Docker PostgreSQL/RLS 契约；不连接生产
pnpm test:auth      # 本地栈 + Mailpit 的 Better Auth 端到端验收
pnpm test:browser   # 必跑浏览器行为层的独立入口，使用离线 fixture
pnpm verify         # 完整验收：每个包只构建一次，含类型/测试/Web 构建/产物/DB/浏览器
pnpm local:up       # 启动本地 Docker 栈（db/redis/web/worker/mailpit）
pnpm local:update   # 重新构建镜像并启动本地栈
pnpm db:status      # 查看已应用/待应用迁移
pnpm db:migrate     # 应用 database/migrations/
pnpm db:schema      # 由已迁移数据库重新生成 database/schema.sql
```

> **注意**：独立 `pnpm test` 会先构建选定测试依赖的包，无需手动 build。完整 `pnpm verify` 要求本地 Docker 已运行，且已执行 `pnpm exec playwright install --only-shell chromium`（Linux CI 加 `--with-deps`）。若本机使用已有 Chrome，可显式运行 `pnpm verify -- --chrome` 或 `pnpm test:browser -- --chrome`，只切换浏览器，不跳过断言；CI 默认仍使用固定 Chromium。不得默认跳过构建或复用旧 dist。

## 项目最小地图

- `packages/core`（`taibu-core`）: 占术计算引擎；通过领域子路径公开 `to*Text()` / `to*Json()` 规范渲染接口。
- `packages/mcp`（`taibu-mcp`）: MCP 协议层。
- `packages/mcp-server`（`taibu-mcp-server`）: MCP 服务端。
- `database/`：数据库唯一事实来源（`bootstrap/` 角色与扩展、`migrations/` 前向迁移、`schema.sql` 生成快照）。
- `deploy/`：Compose、Caddy、PostgreSQL/Redis 配置与备份脚本。

## 强制规范（MUST）

- `API 路由`必须优先使用 `src/lib/api-utils.ts`，禁止在 `route.ts` 里自行创建数据库客户端或连接池。
- `管理员接口`必须使用 `requireAdminUser()` 或 `requireAdminContext()`。
- 需要用户态的接口必须使用 `requireUserContext()`（或等价受控封装），并统一返回 `jsonOk/jsonError`。
- 涉及会员与积分的功能，必须按顺序执行：会员校验 -> 积分校验/扣减 -> 限流校验。
- 服务端数据访问一律通过 `src/lib/db/context.server.ts` 的 `userDb()` / `anonDb()` / `systemDb()` 取得 `ScopedDb`。系统管理员路径只用 `systemDb()`（`request.jwt.claims` 固定为系统用户，仍受 RLS 约束），用户上下文缺失必须失败，禁止回退到 `systemDb()`。严禁把数据访问层或角色口令暴露到客户端。
- 新增表/字段前，必须先检查 `database/schema.sql` 与 `database/migrations/`，并说明“为何不能复用现有结构”。
- 未经明确批准，禁止新增核心目录、系统级模块或数据库主表。
- 新增或修改数据库结构，必须新增 migration；禁止直接改线上表结构。
- 修改 DB 行为时必须评估并同步：RLS、索引、默认值、回填策略、兼容旧数据。
- 新增 AI 分析来源时，必须在 `src/lib/source-contracts.ts` 中注册来源合约并维护映射（旧 `ai/source-contract.ts` 已合并）；持久化统一通过工厂调用 `src/lib/ai/ai-analysis.ts` 的 `createAIAnalysisConversation` 完成。
- 新建文件/模块前，必须先检索已有实现并优先复用，避免平行重复实现。
- 结构归属不明确时，先提问确认后再落盘，禁止猜测目录或表设计。
- 禁止在客户端使用 `alert`；统一使用 Toast 体系（`useToast` / `ToastProvider`）。
- TypeScript 保持 strict 通过；禁止引入无必要的 `any`、`@ts-ignore`。
- 页面层保持轻量，业务逻辑尽量下沉到 `src/lib/*` 或 feature 组件。
- 占术文本/JSON 格式化必须复用 `taibu-core/<领域>` 的 `to*Text()` / `to*Json()` 公开接口（内部 canonical renderer），禁止在 Web 或 MCP 端自行实现格式化逻辑。
- 改动完成后必须补齐最小验证（见"测试与验收"）。

## API 路由标准流程

1. 解析请求（body / query / params）。
2. 参数校验（优先复用 `src/lib/validation.ts`）。
3. 鉴权——按场景选用：
   - `getAuthContext(request)`：可选鉴权，返回 `{ db, user }`（未登录时 `db` 为 anon 作用域，user 为 null）。
   - `requireUserContext(request)`：必须登录，返回 `{ db, user }`。
   - `requireAdminUser(request)` / `requireAdminContext(request)`：管理员鉴权。
4. 权限与业务前置检查（membership、credits、rate limit）。
5. 执行业务逻辑（优先复用 `src/lib/*` 现有模块）。
6. 持久化与审计（通过 `createAIAnalysisConversation` 记录 source 与 conversation）。
7. 返回统一响应（`jsonOk/jsonError` 或 SSE streaming）。

> **占术解读路由**统一使用 `src/lib/api/divination-pipeline.ts` 的 `createInterpretHandler` 工厂：鉴权/资源归属 → 会员与模型权限 → 积分校验/扣减 → 限流 → 提示词/AI 调用 → 原子保存，并在失败时补偿。新增占术解读路由必须复用此入口及内部用例，禁止手动拼装流程；BYOK prepare/persist 保持独立生命周期，不扣平台模型积分。

## 前端实现规范

- 默认使用 Server Component；仅在需要 hooks/浏览器 API/交互状态时使用 `'use client'`。
- 使用 `'use client'` 时，建议在文件头用一行注释说明原因（如“需要 useState + DOM 事件”）。
- 统一使用 `@/` 别名引用 `src` 下模块。
- 静态常量移到组件外，避免重复创建对象/数组。
- 昂贵计算使用 `useMemo`，透传给子组件的函数优先 `useCallback`。
- loading 态优先音浪组件或使用骨架屏（Skeleton）而非闪烁切换。
- 保持现有主题与视觉变量体系（Tailwind + CSS variables），避免引入孤立样式系统。

## 数据库与迁移规范

- 本地用 `pnpm db:migrate` 执行 `database/migrations/`；生产经 ssh-mcp-server 在主机运行 `deploy/deploy.sh <tag>`（迁移由 `migrate` 服务先执行）。禁止直接改线上表结构。
- migration 中涉及安全对象（函数、视图、触发器）时，显式声明 `search_path` 与权限边界。
- 结构变化后运行 `pnpm db:schema` 更新 `database/schema.sql`，并同步相关文档。

## 测试与验收

### 变更最低要求

- 纯文案/样式微调：至少本地手动验证相关页面。
- 业务逻辑变更（`src/lib/*`）：新增或更新对应单测。
- API 行为变更（`src/app/api/*`）：补充路由相关测试（成功、失败、权限边界至少覆盖两类）。
- 涉及鉴权/积分/会员/限流/计费：必须补充回归测试。

### 合并前建议命令

```bash
pnpm lint
pnpm test
```

若只改局部，可先跑受影响测试，再跑全量测试。

## 提交与变更说明

- Commit message 使用 Conventional Commits：`feat: / fix: / refactor: / chore: / docs:`。
- MCP / npm 发布默认不发布 `taibu-mcp-server`，除非用户明确要求。
- npm 发布优先使用 npm access token，不要依赖 OTP 交互流程。
- 版本号遵循 `x.y.z`：
  `x`：重大架构变更
  `y`：功能新增
  `z`：bug 修复
- PR 描述建议包含：
  - 改了什么（行为变化）
  - 为什么改（问题或目标）
  - 如何验证（命令 + 结果）
  - 风险与回滚点（如有）

## 环境变量

- 以 `.env.example` 为准维护变量清单。
- 新增环境变量必须同步更新 `.env.example` 与使用文档。
- 严禁提交真实密钥（包括测试密钥）到仓库。

## 交付检查清单

- [ ] 变更范围清晰，未引入无关重构。
- [ ] 复用现有模块，避免重复实现。
- [ ] 鉴权、权限、积分、限流链路完整。
- [ ] 错误路径可观测（错误码/错误信息一致）。
- [ ] 测试与 lint 已通过，或已明确说明未执行原因。
- [ ] 文档已同步（如涉及接口、配置、迁移、行为变化）。
