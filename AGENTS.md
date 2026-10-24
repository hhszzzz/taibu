# AGENTS.md

公共开发约定统一维护在本文件；架构、运行与 Agent 说明见 `docs/manual/`。

## 强制规范（MUST）

编写任何代码时，都需要先查找是否存在相关已经实现的组件，流程，接口，不可引起重复实现代码

## 常用命令

```bash
pnpm install
pnpm build          # 构建 Core、worker 与 Next.js
pnpm build:packages # 构建 core、mcp、mcp-server
pnpm typecheck      # 构建 packages 后进行 strict 类型检查
pnpm lint
pnpm test           # 自动构建所需包后运行默认测试
pnpm test:db        # 隔离 PostgreSQL 契约
pnpm verify         # 完整验收，需要 Docker 与 Playwright 浏览器
```

> **注意**：`pnpm test` 按选定测试构建依赖包；修改包源码后无需手动 build。禁止默认复用过期 dist。

## 固定本地测试环境

- 通用测试栈使用 Docker Compose 项目 `taibu-v2`（db、redis、web、worker、mailpit），入口以 `.taibu-local/taibu-v2/env/` 生成的端口为准。
- `pnpm local:up` 启动本地栈；`pnpm local:update` 重新构建镜像并启动；`pnpm local:status` / `pnpm local:logs` 检查状态。
- 本地数据卷与生成的密钥保存在 `.taibu-local/taibu-v2/`，不得输出或提交。数据库直接维护 `database/*.sql` 当前定义，不新增历史迁移。

## 项目最小地图

- `packages/core`（`taibu-core`）: 占术计算引擎，以及 **`text.ts` 规范文本渲染层以及`json.ts` 规范json输出格式**。
- `packages/mcp`: MCP 协议层。
- `packages/mcp-server`: MCP 服务端。
- `database/`: 数据库唯一事实来源（bootstrap 与直接维护的当前 SQL）。
- `deploy/`: Compose、Caddy、PostgreSQL/Redis 配置与备份脚本。

## 数据库规范

- `pnpm db:bootstrap` 创建角色与扩展；`pnpm db:init` 应用 `database/` 当前 SQL。Compose 中由 `db-setup`、`db-init` 先于 Web 和 worker 执行。
- `schema.sql` 描述全新库的表与约束，不是生成快照；函数、权限、触发器、索引和系统主体分别维护于同目录 SQL。
- 不维护编号迁移和版本账本。已有库的表或列变更使用明确的 SQL，先备份并验证，随后同步当前定义与生成类型；不得重建已有业务表来替代升级。
- 安全函数、视图和触发器显式声明 `search_path` 与权限边界，同时评估 RLS、索引、默认值、回填和旧数据兼容。
- 生产发布由主机运行 `deploy/deploy.sh <tag>`，具体操作见自托管手册；发布需要用户授权。

## 实现边界

- API 复用 `src/lib/api-utils.ts` 的鉴权、`jsonOk/jsonError`；管理员接口使用 `requireAdminUser()` / `requireAdminContext()`。
- 数据访问通过 `src/lib/db/context.server.ts` 的 `userDb()` / `anonDb()` / `systemDb()`，禁止在路由内创建连接池。缺少用户身份时失败，不得回退为系统主体。
- 占术解读复用 `src/lib/api/divination-pipeline.ts`；来源在 `src/lib/source-contracts.ts` 注册，保存通过现有 `createAIAnalysisConversation`。会员、模型权限、积分、限流和失败补偿保持现有用例边界。
- 占术计算、文本和 JSON 复用 `taibu-core/<领域>` 的公开接口，Web / MCP 不重复实现算法或规范渲染。
- 页面保持轻量，复杂逻辑复用业务模块；保持 TypeScript strict，不引入无必要的 `any` 或 `@ts-ignore`。
- 主题、交互反馈和 Toast 复用现有体系；客户端不使用 `alert`。默认使用 Server Component，需要交互时再用客户端组件。

## 测试与验收

### 变更最低要求

- 纯文案/样式微调：至少本地手动验证相关页面。
- 业务逻辑变更（`src/lib/*`）：新增或更新对应单测。
- API 行为变更（`src/app/api/*`）：补充路由相关测试（成功、失败、权限边界至少覆盖两类）。
- 涉及鉴权/积分/会员/限流/计费：必须补充回归测试。

## 提交与变更说明

- PR 描述建议包含：
  - 改了什么（行为变化）
  - 为什么改（问题或目标）
  - 如何验证（命令 + 结果）
  - 风险与回滚点（如有）
- Commit message 使用 Conventional Commits：`feat: / fix: / refactor: / chore: / docs:`。
- npm 发布优先使用 npm access token，不要依赖 OTP 交互流程。
- 版本号遵循 `x.y.z`：
  `x`：重大架构变更
  `y`：功能新增
  `z`：bug 修复

## 环境变量

- 以 `.env.example` 为准维护变量清单。
- 新增环境变量必须同步更新 `.env.example` 与使用文档。
- 严禁提交真实密钥（包括测试密钥）到仓库。

## 交付检查清单

- [ ] 变更范围清晰，未引入无关重构。
- [ ] 复用现有模块，避免重复实现。
- [ ] 鉴权、权限、积分、限流链路完整。
- [ ] 错误路径可观测（错误码/错误信息一致）。
- [ ] 测试、lint 与 build 已通过，或已明确说明未执行原因。
- [ ] 文档已同步（如涉及接口、配置、迁移、行为变化）。
