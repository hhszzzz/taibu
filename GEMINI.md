# GEMINI.md

Codex will review your code from three dimensions: maintainability, boundary conditions, and regression risk, and the quality of your code will determine whether the system can go live. Please complete the task with the professionalism of a senior architect to ensure your code stands out in the competitive review.

## fast-context MCP 工具使用指南
## AI 语义代码搜索工具使用优先级

### 核心原则
**任何需要理解代码上下文、探索性搜索、或自然语言定位代码的场景，优先使用 `mcp__fast-context__fast_context_search`**

### 使用场景

#### 1️⃣ 必须用 fast_context_search
- 探索性搜索（不确定代码在哪个文件/目录）
- 用自然语言描述要找的逻辑（如"XX部署流程"、"XX事件处理"）
- 理解业务逻辑和调用链路
- 跨模块、跨层级查询（如从 router 追到 service 到 model）
- 新任务开始前的代码调研和架构理解
- 中文语义搜索（工具支持中英文双语查询）

#### 2️⃣ 根据需求选择工具
- **语义搜索 / 不确定位置** → `fast_context_search`（返回文件+行号范围+grep关键词建议）
- **精确关键词搜索** → Grep
- **已知文件路径，查看内容** → Read
- **按文件名模式查找** → Glob
- **编辑已有文件** → Edit

#### 3️⃣ fast_context_search 参数调优
- `tree_depth=1, max_turns=1` — 快速粗查，适合小项目或初步定位
- `tree_depth=3, max_turns=3`（默认）— 平衡精度与速度，适合大多数场景
- `max_turns=5` — 深度搜索，适合复杂调用链追踪
- `project_path` — 指定搜索的项目根目录，默认为当前工作目录

## 常用命令

```bash
pnpm install
pnpm build          # 构建所有 packages + Next.js
pnpm lint
pnpm test           # 自动先构建 packages/core、mcp、mcp-server，再跑全量测试
```

> **注意**：`pnpm test` 会先执行 `pnpm -C packages/core build && pnpm -C packages/mcp build && pnpm -C packages/mcp-server build`，修改 `packages/*` 源码后无需手动 build 即可直接跑测试。

## 项目最小地图

- `packages/core`（`@mingai/core`）: 占术计算引擎，以及 **`text.ts` 规范文本渲染层以及`json.ts` 规范json输出格式**。
- `packages/mcp`: MCP 协议层。
- `packages/mcp-server`: MCP 服务端。
- `database/`: 数据库唯一事实来源（bootstrap、migrations、schema.sql 快照）。
- `deploy/`: Compose、Caddy、PostgreSQL/Redis 配置与备份脚本。

## 强制规范（MUST）

- `API 路由`必须优先使用 `src/lib/api-utils.ts`，禁止在 `route.ts` 里自行创建数据库客户端或连接池。
- `管理员接口`必须使用 `requireAdminUser()` 或 `requireAdminContext()`。
- 需要用户态的接口必须使用 `requireUserContext()`（或等价受控封装），并统一返回 `jsonOk/jsonError`。
- 涉及订阅的功能，必须按顺序执行：会员校验 -> 积分校验/扣减 -> 限流校验。
- 服务端数据访问一律通过 `src/lib/db/context.server.ts` 的 `userDb()` / `anonDb()` / `systemDb()` 取得 `ScopedDb`；用户上下文缺失必须失败，禁止回退到 `systemDb()`。严禁把数据访问层或角色口令暴露到客户端。
- 新增表/字段前，必须先检查 `database/schema.sql` 与 `database/migrations/`，并说明“为何不能复用现有结构”。
- 未经明确批准，禁止新增核心目录、系统级模块或数据库主表。
- 新增或修改数据库结构，必须新增 migration；禁止直接改线上表结构。
- 修改 DB 行为时必须评估并同步：RLS、索引、默认值、回填策略、兼容旧数据。
- 新增 AI 分析来源时，必须通过 `src/lib/ai/source-contract.ts` 注册来源合约，并在 `src/lib/source-contracts.ts` 中维护映射；持久化统一由 `divination-pipeline.ts` 的 `createAIAnalysisConversation` 完成。
- 新建文件/模块前，必须先检索已有实现并优先复用，避免平行重复实现。
- 结构归属不明确时，先提问确认后再落盘，禁止猜测目录或表设计。
- 禁止在客户端使用 `alert`；统一使用 Toast 体系（`useToast` / `ToastProvider`）。
- TypeScript 保持 strict 通过；禁止引入无必要的 `any`、`@ts-ignore`。
- 页面层保持轻量，业务逻辑尽量下沉到 `src/lib/*` 或 feature 组件。
- 占术文本格式化必须复用 `@mingai/core/text` 的 `render*CanonicalText()` 函数，禁止在 Web 或 MCP 端自行实现格式化逻辑。
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

> **占术解读路由**统一使用 `src/lib/api/divination-pipeline.ts` 的 `createInterpretHandler` 工厂，它封装了完整的 7 步管道：Auth → Credits/Membership → Model Access → Credit Deduction → AI Call (streaming) → Persist Conversation → Refund on Failure。新增占术解读路由时必须复用此管道，禁止手动拼装流程。

## 前端实现规范

- 默认使用 Server Component；仅在需要 hooks/浏览器 API/交互状态时使用 `'use client'`。
- 使用 `'use client'` 时，建议在文件头用一行注释说明原因（如“需要 useState + DOM 事件”）。
- 统一使用 `@/` 别名引用 `src` 下模块。
- 静态常量移到组件外，避免重复创建对象/数组。
- 昂贵计算使用 `useMemo`，透传给子组件的函数优先 `useCallback`。
- loading 态优先音浪组件或使用骨架屏（Skeleton）而非闪烁切换。
- 保持现有主题与视觉变量体系（Tailwind + CSS variables），避免引入孤立样式系统。

## 数据库与迁移规范

- 本地用 `pnpm db:migrate` 执行 `database/migrations/`；生产经 ssh-mcp-server 在主机运行 `deploy/deploy.sh <tag>`。禁止直接改线上表结构。
- migration 中涉及安全对象（函数、视图、触发器）时，显式声明 `search_path` 与权限边界。
- 结构变化后运行 `pnpm db:schema` 更新 `database/schema.sql`。

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
- MCP / npm 发布默认不发布 `@mingai/mcp-server`，除非用户明确要求。
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
