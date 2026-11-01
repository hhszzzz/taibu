# AGENTS.md

公共开发约定统一维护在本文件；架构、运行与 Agent 说明见 `docs/manual/`。

## 强制规范（MUST）

编写任何代码时，都需要先查找是否存在相关已经实现的组件，流程，接口，不可引起重复实现代码

## 规范索引

详细工程与设计规范统一维护在 [docs/engineering/README.md](docs/engineering/README.md)。`src/components/ui` 之外不再有原生按钮、文本输入或 textarea；盘面、认证与实测过的聊天几何保留领域样式，但交互统一走共享 Button/Input/SegmentedControl。可用 API 与例外以 `docs/engineering/components.md` 和 `src/components/ui` 当前源码为准。

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
pnpm release prepare <major|minor|patch>  # 本地生成版本提交、CHANGELOG 与标签，不推送
```

> **注意**：`pnpm test` 按选定测试构建依赖包；修改包源码后无需手动 build。禁止默认复用过期 dist。

## 固定本地测试环境

- 通用测试栈使用 Docker Compose 项目 `taibu-v2`（db、redis、web、worker、mailpit），入口以 `.taibu-local/taibu-v2/env/` 生成的端口为准。
- `pnpm local:up` 启动本地栈；`pnpm local:update` 重新构建镜像并启动；`pnpm local:status` / `pnpm local:logs` 检查状态。
- 本地数据卷与生成的密钥保存在 `.taibu-local/taibu-v2/`，不得输出或提交。数据库以 `database/*.sql` 的当前定义为准，只有下文「数据库规范」要求的结构变更才追加编号迁移。

## 项目最小地图

- `packages/core`（`taibu-core`）: 占术计算引擎，以及 **`text.ts` 规范文本渲染层以及`json.ts` 规范json输出格式**。
- `packages/mcp`: MCP 协议层。
- `packages/mcp-server`: MCP 服务端。
- `database/`: 数据库唯一事实来源（bootstrap 与直接维护的当前 SQL）。
- `deploy/`: Compose、Caddy、PostgreSQL/Redis 配置与备份脚本。

## 数据库规范

- `pnpm db:bootstrap` 创建角色与扩展；`pnpm db:init` 先执行 `database/migrations/` 中未应用的迁移，再应用 `database/` 当前 SQL。Compose 中由 `db-setup`、`db-init` 先于 Web 和 worker 执行。
- `schema.sql` 描述全新库的表与约束，不是生成快照；函数、权限、触发器、索引和系统主体/数据不变量分别维护于同目录 SQL。`db:init` 只应用与反解文本不同的对象，并删除未声明的函数、视图、策略、触发器与索引。
- 维护编号迁移与版本账本 `taibu_meta.schema_migrations`（校验和、执行耗时、baseline 标记）：建表、加列、补约束和放宽 NOT NULL 由 `db:init` 自动补齐；删表删列、改类型、回填和约束收紧写进 `database/migrations/NNNN_*.sql`。已应用的迁移文件不得修改，只能追加新迁移。空库建好后把全部迁移记为 baseline。
- 删除、改名和类型转换先于自动补齐执行，因此每个迁移都要带存在性守卫（`IF EXISTS` / `to_regclass` / 列存在判断），对任意旧形态都能跑。`pnpm db:init --check` 只打印待执行迁移与补齐计划。
- 安全函数、视图和触发器显式声明 `search_path` 与权限边界，同时评估 RLS、索引、默认值、回填和旧数据兼容。
- 生产发布由主机运行 `deploy/deploy.sh <tag>`，具体操作见自托管手册；发布需要用户授权。

## 实现边界

- API 复用 `src/lib/api-utils.ts` 的鉴权、`jsonOk/jsonError`；管理员接口使用 `requireAdminUser()` / `requireAdminContext()`。
- 数据访问通过 `src/lib/db/context.server.ts` 的 `userDb()` / `anonDb()` / `systemDb()`，禁止在路由内创建连接池。缺少用户身份时失败，不得回退为系统主体。
- 占术解读复用 `src/lib/api/divination-pipeline.ts`；来源在 `src/lib/source-contracts.ts` 注册，保存通过现有 `createAIAnalysisConversation`。模型定价与余额准入、按用量计费、限流和失败处理保持现有用例边界。
- 占术计算、文本和 JSON 复用 `taibu-core/<领域>` 的公开接口，Web / MCP 不重复实现算法或规范渲染。
- 页面保持轻量，复杂逻辑复用业务模块；保持 TypeScript strict，不引入无必要的 `any` 或 `@ts-ignore`。
- 主题、交互反馈和 Toast 复用现有体系；客户端不使用 `alert`。默认使用 Server Component，需要交互时再用客户端组件。

## 测试与验收

### 变更最低要求

- 纯文案/样式微调：至少本地手动验证相关页面。
- 业务逻辑变更（`src/lib/*`）：新增或更新对应单测。
- API 行为变更（`src/app/api/*`）：补充路由相关测试（成功、失败、权限边界至少覆盖两类）。
- 涉及鉴权/计费/限流：必须补充回归测试。

## 提交与变更说明

- PR 描述建议包含：
  - 改了什么（行为变化）
  - 为什么改（问题或目标）
  - 如何验证（命令 + 结果）
  - 风险与回滚点（如有）
- Commit message 使用 Conventional Commits：`feat: / fix: / refactor: / chore: / docs:`。
- npm 发布优先使用 npm access token，不要依赖 OTP 交互流程；用 `pnpm publish`，按 `taibu-core` → `taibu-mcp` → `taibu-mcp-server` 的顺序。
- 应用版本号遵循 `x.y.z`：
  `x`：重大架构变更
  `y`：功能新增
  `z`：bug 修复
- npm 包各自遵循语义化版本；每个应用版本在 `CHANGELOG.md` 写一段，需要运维动作的变更同步 `docs/UPGRADE.md`。文档分工、版本与发布步骤见 [文档与发布规范](docs/engineering/documentation.md)。

## 分支

- 按工作域用固定分支：MCP → `mcp`，Agent → `taibu-agent`，Core（`packages/core`）→ `core`。
- 其他改动直接进 `master`，需要隔离时用临时分支（`feat/*`、`fix/*` 等）；合入 `master` 后删除。
- 固定分支的内容合入 `master` 后同样删除，下次从 `master` 重建，不保留并行副本。

## 环境变量

- 以 `.env.example` 为准维护变量清单。
- 新增环境变量必须同步更新 `.env.example` 与使用文档。
- 严禁提交真实密钥（包括测试密钥）到仓库。

## 交付检查清单

- [ ] 变更范围清晰，未引入无关重构。
- [ ] 复用现有模块，避免重复实现。
- [ ] 鉴权、权限、计费、限流链路完整。
- [ ] 错误路径可观测（错误码/错误信息一致）。
- [ ] 测试、lint 与 build 已通过，或已明确说明未执行原因。
- [ ] 文档已同步（如涉及接口、配置、迁移、行为变化）。
