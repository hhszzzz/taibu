# 数据库材料与验证边界

本目录包含表结构快照、经筛选的历史 SQL 及新增修复迁移。**它不是完整、可直接执行的数据库初始化基线。** 当前未连接或更新生产数据库。

## 材料与可信范围

| 材料 | 能说明的内容 | 不能证明的内容 |
|---|---|---|
| `tabel_export_from_supabase.sql` | 42 张表、字段及部分约束的上下文 | 可执行建库顺序，完整函数/RLS/索引/授权，生产部署状态 |
| `migrations/` 显式允许列表 | 对应历史定义的原文、静态检查及隔离契约测试输入 | 完整迁移链，或线上最终定义 |
| `scripts/check-architecture-guards.mjs` | 声明的源码与 SQL 安全约束没有意外删除 | 实际事务、并发和授权行为 |
| `scripts/tests/postgres-fixture.mjs` | 19 项 SQL 来源清单及准确的提取、加载顺序 | Supabase Auth、JWT 签名、PostgREST 或全迁移回放 |
| `pnpm test:db` | 下述隔离 PostgreSQL/RLS/事务契约 | 生产等价性、历史数据回填正确性或完整应用端到端行为 |

## 版本控制与来源

`.gitignore` 仅允许静态守卫依赖及 `SQL_SOURCE_MANIFEST` 中明确使用的 SQL；其余本地迁移仍被忽略。`pnpm test:guards` 检查输入存在且未被忽略。纳入允许列表不代表文件已经提交；交付时需连同测试与新增修复一并审核。

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

已在本机执行 **22/22 测试通过，0 skip**（2026-10-02），覆盖：

- 两个普通用户、管理员登录态与实际 `service_role` 的权限差异。
- RLS 隔离、匿名/无身份拒绝和 bare ledger RPC 执行权限。
- 并发积分扣减与流水一致性；失败时原子回滚。
- 会话 JSON/规范消息行一致性，以及历史绑定的归属检查。
- 塔罗已有记录绑定、新建记录与会话/消息一致性、跨用户拒绝、注入历史写失败后的完整回滚。
- 知识块原子替换与归档，以及真实 FTS、trigram、vector 检索。

**身份 fixture 限制：** `auth.users`、`auth.uid()`、`auth.role()` 是明确的最小测试对象，通过事务内 claim settings 模拟已验证身份；不验证 JWT 签名或实际 Supabase Auth。表入口授权为 harness 专用，不能据此推断线上 default privileges。管理员登录会话不是 `service_role`：当前 `getSystemAdminClient()` 使用的是管理员登录 JWT。

## 两份新增修复（仅在临时实例执行）

| 迁移 | 修复 | 兼容与权限影响 |
|---|---|---|
| `20261002_100000_fix_knowledge_search_contracts.sql` | FTS 参数使用实际 `regconfig`；固定 `pg_catalog, public, extensions` 搜索路径；修复返回列名歧义 | 保留三个 RPC 签名和 `auth.uid()` owner 条件、`SECURITY INVOKER`；撤销 PUBLIC/anon 执行，仅 authenticated/service_role；非登录上下文仍不能检索 |
| `20261002_101000_restrict_credit_ledger_rpc.sql` | 禁止普通用户或管理员登录态直接伪造积分流水 | bare `record_credit_transaction` 仅向 service_role 授权，业务 SECURITY DEFINER RPC 继续由函数 owner 执行内部流水写入；固定搜索路径 |

不新增表、字段、索引或默认值，不改余额算法，无数据回填；42 表快照不变。修复是函数/ACL 层变更，因此此文档和 SQL 原文是补充依据。应用未直接调用 bare ledger RPC，但生产应用前仍必须核对外部调用者和部署中的函数 owner/授权。

## CI 与生产应用门槛

`quality.yml` 在 GitHub 托管 runner 上执行 `pnpm test:db`，创建相同临时容器；不使用生产凭据、不连接 Supabase、不部署。工作流尚须在提交后由远程 CI 实际执行，不能用本机通过替代远程结果。

生产应用必须另行授权，并通过项目规定的 Supabase MCP migration 流程。应用前核对真实函数定义、扩展 schema、owner、ACL/RLS、已应用历史及备份恢复；必要时增补前向兼容修复。**不要直接把整份 fixture 或历史文件列表用于迁移，也不要以恢复不安全 ACL 作为回滚。** 本轮只完成有明确来源和边界的隔离契约验证，不宣称已建立生产权威数据库基线。
