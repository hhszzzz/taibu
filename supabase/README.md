# 数据库材料与验证边界

本目录包含表结构快照、经筛选的历史 SQL 及新增修复迁移。**它不是完整、可直接执行的数据库初始化基线。** 2026-10-02 已获准只读核对真实 catalog；2026-10-03 经单独批准，三份修复已通过 Supabase MCP 应用并只读复核。没有读取或回填业务数据，不据此宣称全库或历史数据安全；执行版本映射见验收记录。

## 材料与可信范围

| 材料 | 能说明的内容 | 不能证明的内容 |
|---|---|---|
| `tabel_export_from_supabase.sql` | 42 张表、字段及部分约束的上下文 | 可执行建库顺序，完整函数/RLS/索引/授权，生产部署状态 |
| `migrations/` 显式允许列表 | 对应历史定义的原文、静态检查及隔离契约测试输入 | 完整迁移链，或线上最终定义 |
| `scripts/check-architecture-guards.mjs` | 声明的源码与 SQL 安全约束没有意外删除 | 实际事务、并发和授权行为 |
| `scripts/tests/postgres-fixture.mjs` | 当前 25 项基础 SQL 来源与真实 Auth 模式的 7 项增量输入（共 32 项），以及准确的提取、加载顺序 | 生产完整迁移链或已部署定义 |
| `pnpm test:db` | 下述隔离 PostgreSQL/RLS/事务契约（模拟 claims） | 真实 JWT/Auth、生产等价性、历史数据回填正确性 |
| `pnpm test:auth` | 真实 GoTrue/PostgREST/JWT 与用户更新、塔罗、历史、知识库链路 | OAuth/邮件、完整 Next 浏览器端到端、生产配置/schema 等价 |

## 版本控制与来源

`.gitignore` 仅允许静态守卫依赖及 `SQL_SOURCE_MANIFEST` / `AUTH_SQL_SOURCE_MANIFEST` 中明确使用的 SQL；其余本地迁移仍被忽略。`pnpm test:guards` 检查两个清单的输入存在且未被忽略。纳入允许列表不代表已经部署；历史材料与测试一并审核。

不改写历史 SQL 定义；首次纳入版本控制时，仅规整了 `fix_login_attempts_rls.sql` 一个空白行的尾随空格，函数和策略内容不变。Fixture 从表快照选取 `users`、`credit_transactions`、`conversations`、`mbti_readings`、`tarot_readings`；其余测试表、RPC 和 RLS 取自清单中的历史 SQL。唯一快照语法适配是延后 `conversations.source_type` 的内联 `NOT VALID CHECK`，随后执行原 July ALTER 安装该约束，发生在插入测试数据之前。

加载保留管理员策略、消息表、积分授权修订及历史包装函数的先后次序；修复迁移最后原文执行。知识库使用真实 `vector` 类型、索引、唯一约束及来源 ID 的 TEXT 变更，不以文本字段模拟向量。

部分仅供静态检查的历史文件描述已退役 MCP 鉴权对象。**不得在现有数据库上整体重放允许列表，或把旧授权恢复到生产。** 列表只保证本地测试输入可复现，不补造缺失的部署历史。

## 本地真实 PostgreSQL 验收

前置条件：本地 Docker daemon 已运行；可获取固定测试镜像 `pgvector/pgvector:0.8.6-pg16`。

```bash
pnpm test:guards
pnpm test:db
```

安全约束：

- 仅允许 Unix socket Docker endpoint，拒绝远程 Docker。
- 每次创建随机名称及运行标签的独立容器；不接触已有数据库。
- 网络为 `none`，无宿主端口、无 host bind；数据目录为 tmpfs。
- 随机临时密码经子进程环境传入，不写仓库或日志。
- 仅在标签匹配本次运行时清理容器；失败、SIGINT、SIGTERM 也尝试清理。
- 缺 Docker 或 SQL 输入明确失败，不标记 skip。SIGKILL/宿主机崩溃不能保证自动清理；只能核对本次标签后人工清理残留，禁止全局 prune。

已在主工作区执行 **34/34 测试通过，0 skip**（2026-10-03），覆盖：

- 两个普通用户、管理员登录态与实际 `service_role` 的权限差异。
- RLS 隔离、匿名/无身份拒绝和 bare ledger RPC 执行权限。
- 并发积分扣减与流水一致性；失败时原子回滚。
- 会话 JSON/规范消息行一致性，以及历史绑定的归属检查。
- 塔罗已有记录绑定、新建记录与会话/消息一致性、跨用户拒绝、注入历史写失败后的完整回滚。
- 知识块原子替换与归档，以及真实 FTS、trigram、vector 检索。
- 宽 CRUD 授权下的敏感字段/流水拒绝、普通资料与旧 NULL 数据兼容、upsert、管理员/owner/service 合法写入。
- 当前激活/签到/月度会员 RPC、重复领取、并发/超额边界、失败回滚及迁移前置检查原子失败。

**身份 fixture 限制：** `auth.users`、`auth.uid()`、`auth.role()` 是明确的最小测试对象，通过事务内 claim settings 模拟已验证身份；不验证 JWT 签名或实际 Supabase Auth。`users` / `credit_transactions` 的 anon/authenticated CRUD 与管理员谓词 EXECUTE 已按已核对的真实权限建模，并显式确认没有额外 TRUNCATE 权限；其他表入口授权仍为限定 harness，不能据此推断全库 default privileges。管理员登录会话不是 `service_role`：当前 `getSystemAdminClient()` 使用的是管理员登录 JWT。

## 真实 Auth / PostgREST 纵向验收

```bash
pnpm test:auth
```

入口为 `scripts/tests/auth-postgrest-acceptance.test.mjs`，栈装配为 `local-auth-stack.mjs`，复用 `buildPostgresFixture(..., { authMode: 'gotrue' })`。原 SQL suite 默认仍使用 synthetic 模式。真实模式先由 GoTrue 建立 Auth schema，不自行创建模拟 `auth.users`；JWT 由 GoTrue 签发、Auth/PostgREST 校验。

固定组件：`pgvector/pgvector:0.8.6-pg16`、`supabase/gotrue:v2.196.0`、`postgrest/postgrest:v14.17`、`node:24.13.0-alpine3.23`（固定路径 HTTP 转发）。不包含 Studio、Storage、Realtime、邮件发送或 TLS。首次运行需要下载镜像。

- Auth/REST/DB 只连接 internal Docker 网络；转发器另接桥接网络，仅发布随机 `127.0.0.1` 端口，目标固定为 Auth/REST，不参与鉴权。
- 唯一名称与标签、tmpfs、无 host bind 或已有卷。应用测试进程清除继承的供应商/生产配置，网络仅允许本次 loopback 端口；不读取 `.env`，不调用真实模型。
- 秘密随机生成，只存在进程/临时容器内，诊断脱敏。成功、失败、SIGINT/SIGTERM 按本次标签清理，清理后验证剩余资源为零。镜像缓存保留，不执行全局 prune；SIGKILL/宿主崩溃仍不保证自动清理。
- 使用实际应用处理器与 SDK；BYOK 通过本地 HTTP adapter 调用实际处理器。不是完整 Next 服务/UI 端到端验证。只有推理边界是控制桩。

真实模式的 **7 项增量来源**：

| SQL | 选取内容 |
|---|---|
| `20260110_add_user_settings_and_fix_notifications_rls.sql` | 用户设置表/策略，不执行无关通知修改 |
| `20260401_add_chart_prompt_detail_level_to_user_settings.sql` | 已有提示词详细级别 |
| `20260113_add_app_settings.sql` | 应用设置 |
| `20260128_create_ai_model_tables.sql` | 模型策略，表结构来自快照 |
| `20260318_unify_ai_gateway_sources.sql` | 网关/绑定策略；不执行旧清库、数据重建或整份文件 |
| `20260409_000100_remaining_atomicity_rpcs.sql` | 既有限流原子 RPC |
| `20260411_111500_restrict_admin_session_rpc_acl.sql` | 该限流 RPC 的授权 |

其中两项已在原静态守卫允许列表中，本次只新增五个历史文件到版本控制。初建 fixture 时，快照缺少的 `rate_limits_id_seq` 与 `(identifier, endpoint)` 唯一索引均为显式假设；后续授权只读核对已确认真实库存在相应 sequence/唯一约束。**表入口授权、部分 RLS、字段类型及扩展版本仍不等价，不能把局部确认推广为完整生产基线。** 没有新增业务主表或修改生产结构。

权限补强后，基础清单在原 19 项上增加 5 项历史来源与新的保护迁移，共 25 项；加上上述 7 项 Auth 输入，总计 32 项。新增历史来源用于激活策略、provider 表、真实 Auth 触发器绑定、月度领取并发和签到超额规则，均按显式边界提取。Auth 模式使用完整 `user_settings` 快照；空的八字/紫微表仅保留其外键引用，不因此声称验证了这两个领域。

2026-10-03 主工作区完整 `pnpm verify -- --chrome` 中 **21/21 Auth/REST、34/34 SQL 通过，0 skip**。除了原登录/刷新/退出、塔罗/BYOK/历史/知识库链路，还验证真实 Auth 触发器创建 public profile、metadata/email 同步不改变权益、provider 唯一性回滚，以及真实 JWT 下的直接表权限与会员 RPC。登出撤销 refresh token，但旧 access JWT 仍可能被无状态 PostgREST 接受到过期，边界不变。

另在主工作区用精确 PostgreSQL `17.6` / vector `0.8.0` 镜像运行同一套 Auth/REST 验收，**21/21 通过**，并独立断言实际版本。镜像来源为 `pgvector/pgvector@sha256:09c8aaae717baf4412f6efd174f51172c0638720a72a86e804cd698197fc8ba2`（linux/arm64）；默认 gate 仍使用原固定 PG16 镜像。精确版本验证不代表整个生产配置、历史数据或所有领域等价。

## 本轮修复迁移（2026-10-03 已获授权应用并复核）

| 迁移 | 修复 | 兼容与权限影响 |
|---|---|---|
| `20261002_100000_fix_knowledge_search_contracts.sql` | FTS 参数使用实际 `regconfig`；固定 `pg_catalog, public, extensions` 搜索路径；修复返回列名歧义 | 保留三个 RPC 签名和 `auth.uid()` owner 条件、`SECURITY INVOKER`；撤销 PUBLIC/anon 执行，仅 authenticated/service_role；非登录上下文仍不能检索 |
| `20261002_101000_restrict_credit_ledger_rpc.sql` | 收紧裸积分流水 RPC 的调用权限，不等于收紧直接表写入 | bare `record_credit_transaction` 仅向 service_role 授权，业务 SECURITY DEFINER RPC 继续由函数 owner 执行内部流水写入；固定搜索路径；仍须另外核对表级 ACL/RLS |
| `20261002_102000_protect_account_and_ledger_writes.sql` | 用户身份/管理员/会员/积分字段的直接写保护，以及普通用户流水 INSERT 限制 | invoker 触发器按有效 SQL 身份区分可信 owner、service_role、管理员与普通调用者；普通插入仅接受安全初始值，更新不得改变受保护值；ledger restrictive policy 不影响自身读取或合法事务内记账；已通过上述本地双版本验收，线上安装状态已只读复核 |

不新增表、字段、索引或默认值，不改余额算法，无数据回填；42 表快照不变。修复是函数/ACL 层变更，因此此文档和 SQL 原文是补充依据。应用未直接调用 bare ledger RPC，但生产应用前仍必须核对外部调用者和部署中的函数 owner/授权。

## CI 与生产应用门槛

`quality.yml` 在 GitHub 托管 runner 上执行完整 `pnpm verify`，强制包括 `test:db` 的真实 SQL 层和 `test:auth` 的真实 Auth/REST 层；不使用生产凭据、不连接生产 Supabase、不部署。精确提交与远程结果记录在[草稿验收 PR #16](https://github.com/hhszzzz/taibu/pull/16)；本机通过不能替代当前候选的远程 CI 结果。

生产应用必须另行授权，并通过项目规定的 Supabase MCP migration 流程。应用前核对真实函数定义、扩展 schema、owner、ACL/RLS、已应用历史及备份恢复；必要时增补前向兼容修复。**不要直接把整份 fixture 或历史文件列表用于迁移，也不要以恢复不安全 ACL 作为回滚。** 本轮只完成有明确来源和边界的隔离契约验证，不宣称已建立生产权威数据库基线。
