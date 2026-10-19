# 本地应用数据库基线

仅用于**全新的、本地自托管数据库**；不是生产 schema 导出，也不是历史 migration 全量重放。复用现有 42 张业务表，加上 9 张 Agent 运行表与 4 张功能表（提示词增强额度、每日早报任务、Agent 长期记忆、公开分享 `conversation_shares`），共 55 张表；Agent runtime、Pi Durable 与公开分享迁移包含在空库基线中。生成器不联网、不启动 Docker、不连接数据库。

## 文件与执行顺序

1. 平台创建角色及 `extensions` schema，将 `vector`、`pg_trgm` 安装到该 schema。
2. GoTrue 完成真实 `auth` migrations，至少存在 `auth.users`、`auth.identities`、`auth.sessions`。
3. 调用方开启事务，执行 `001-application.sql`，随后执行 `supabase/migrations/20261003_100000_fix_rate_limit_admission.sql`，记录启动指纹，再提交。**这两个 selfhost SQL 文件都不包含外层 BEGIN/COMMIT**。任何失败必须回滚整阶段；不要逐条以 autocommit 执行。
4. Storage 服务完成真实 `storage` migrations。
5. 在另一事务中执行 `002-storage.sql`，记录 Storage 阶段完成状态，再提交。
6. PostgREST 刷新 schema cache。SQL 包含通知；平台仍需保证启动顺序。

`001` 创建应用表、函数、索引、约束、触发器、RLS/ACL，以及从 `request.jwt.claims` 读取 `auth.uid()`/`auth.role()` 的访问器；**JWT 验签由 PostgREST 执行**。不会伪造 Auth/Storage 表或身份。`001` 拒绝非 `postgres` 执行和已有 public 业务表；`002` 拒绝未初始化 Storage 或已有头像 bucket。

`manifest.json` 记录源文件 SHA-256、55 表与两个归档状态视图、61 个引用 RPC，以及 Agent worker 的类型化调用点，以及所有字面量 `.from()` 关系、动态 `tableName`/类型适配器/命盘工厂目录的来源和受阻功能。新增无法解析的动态关系或缺失表/视图会使生成器失败；Storage bucket 调用单独列为排除项。`source-views.sql` 保存带来源指纹的视图片段；两个视图均使用 `security_invoker`，仅授予 authenticated/service_role SELECT，底层表继续使用调用者 RLS。对话视图同时约束归档记录与对话的 `user_id`。`source-rpcs.sql` 仅保存经审查的本地 SQL 片段及原文件 SHA-256，是生成器输入，**不得直接执行**。原始本地文件不需要额外提交；未复制用户、模型、密钥或生产数据。

```sh
node scripts/selfhost-schema.mjs              # 校验来源与产物无漂移
node scripts/selfhost-schema.mjs --write      # 修改已审查输入后重新生成
node --test scripts/tests/selfhost-schema.test.mjs
```

启动器必须用 manifest、SQL、后续 migration 内容的组合指纹校验复用卷，指纹不一致时拒绝启动，不能重放初始化。`public` schema comment 为 `taibu-selfhost-v1:<manifest.sourceFingerprint>`，只作基线标识；它不能替代启动器的全阶段状态与内容指纹。旧数据升级/回填不在本方案范围内。

## 命盘时间规则迁移

`20261005_110000_chart_time_resolution.sql` 为既有八字／紫微表增加 `timezone` 与 `disambiguation`。地点文本和经度不能表达 IANA 时区及重复／缺失时间策略，因此不能复用这些字段。旧行使用原默认 `Asia/Shanghai`／`reject`，不推断时区、不重算旧结果；所有权 RLS 与授权保持不变，无额外查询索引。Agent 的命盘去重另由 `20261005_120000_agent_chart_identity.sql` 更新，依赖运行表和时间字段迁移，随后应用 Pi Durable 迁移。

空库生成器按 Agent runtime → 时间字段 → Agent 命盘身份 → Pi Durable → Agent 生命周期修复的顺序合入迁移。`20261006_110000_agent_lifecycle_fixes.sql` 复用现有版本 JSON 保存编辑分支尾部，并在活动任务结算前拒绝对话删除；无新增表、字段、默认值、索引或历史回填。时间字段迁移本身不依赖 Agent，可独立应用。**已有数据库必须在部署新 Web/API 前按顺序应用相应迁移**；不能重放 `001-application.sql`，也不能因字段缺失而静默丢弃时间选项。新增字段需要保留用于应用回滚；先回滚应用不会删除保存的时间规则。当前仓库只提供本地迁移和验证入口，不表示已更新线上数据库。

## 公开分享迁移

`20261019_100000_conversation_shares.sql` 新增 `conversation_shares`：公开链接需要独立的能力令牌、撤销时间和脱敏快照，`conversations` 本身受所有者 RLS 保护且包含版本与运行态，不能直接对匿名开放，因此不复用现有表。表上只有所有者 SELECT 策略，API 角色无任何直接写权限；创建/刷新/撤销通过 `upsert_conversation_share`、`revoke_conversation_share`（仅 authenticated，函数内校验 `auth.uid()` 所有权、活动 Agent 任务与对话版本），匿名访客只能经 `get_conversation_share(token)` 读取未撤销快照的展示字段。新表无历史回填；已有本地栈由 `scripts/selfhost.mjs` 的审查升级链就地补这一条迁移。

## 来源与本地安全差异

- `tabel_export_from_supabase.sql` 只作为列/类型/主键/外键清单。生成器显式将 `ARRAY` 占位改为 `text[]`、`USER-DEFINED` 改为 `extensions.vector`，将 inline `NOT VALID` CHECK 改为在空表上有效的 CHECK；先建表，再添加外键。
- 从历史 SQL 恢复 export 未包含的唯一约束、索引、向量 metadata CHECK、消息/知识库子表的已知删除级联。没有重放历史数据迁移、过期积分/订单/MCP 表或模型种子。
- 本地权限是明确的新基线，不宣称生产 RLS 完全一致：普通用户只管理自己的命盘、解读记录、对话、知识库、设置；记录关联的对话、知识库和默认命盘须属于同一用户。积分流水、签到、OAuth 绑定、案例分析、计划提醒等由用户只读、管理员 JWT 写入。
- 管理员仍以 **authenticated + `is_admin_user()`** 登录，不回退到 service role。保留最新会员/积分事务、管理员准入修订、Auth profile 同步，以及 20261002 的积分 RPC 禁止直调与账户权益触发器保护。
- 新函数默认不向 PUBLIC 暴露 EXECUTE；明确按原函数授权或本地规则授权。调用方必须保证应用角色不拥有 public CREATE 权限、不是表 owner、不能继承 postgres。
- 本地修正 `delete_conversation_graph` 的知识条目删除范围：必须通过知识库确认调用者所有权，防止删除其他用户保存的同一来源条目。
- 两个向量写入 RPC 不再依赖来源缺失的 `isfinite(float8)`：直接排除 NULL、Infinity、-Infinity、NaN，并把小数点正则改成 `[.]`，避免不同来源的反斜杠转义差异；保持原签名、用户过滤、维数检查与 metadata 写入。这是本地兼容修订，不是已执行的生产修复。
- 头像沿用 `<uid>-<timestamp>.<extension>`，不是 `<uid>/...`。本地限制 2 MiB 和 PNG/JPEG/WebP/GIF/AVIF，拒绝 SVG；只允许本人写入/覆盖/删除。公开 bucket 下载由 Storage public endpoint 提供，不开放匿名对象列表。

## 已知边界与必须验证项

- **社区功能关闭**：缺少投票/评论计数触发器及完整审核语义来源。四张真实社区表保留，但不授予应用角色访问策略；三个现有社区 RPC 撤销调用权限，并设置 `feature_disabled:community=true`。不要用全表放权绕过。
- 限流旧 RPC 在 `001` 结尾撤销应用调用权，必须接着执行独立的 `20261003_100000_fix_rate_limit_admission.sql`，不可只运行 `001` 后启动应用。
- 不含真实用户、管理员账号、模型配置或外部凭据；启动器通过 GoTrue 正常创建用户，再按明确的本地种子流程授予管理员标记。
- 平台将 `knowledge_entries` 的 ownership 交给可信维护角色 `taibu_vector_owner`，并授予 `CREATE ON SCHEMA public` 以执行实际索引维护。该角色因此**可以在 public 创建 schema 对象，不是仅具有单表索引权限**；必须保护维护凭据，不向应用角色授予其成员关系，不转移其他表/函数。维护服务只注入所需维护凭据/数据库 URL，并限制配置读取与网络入口。
- 当前静态测试检查来源/产物、全表覆盖、权限结构、事务组合、RPC 清单和本地安全修订；**不等于 PostgreSQL 运行时验收**。父流程须验证真实 GoTrue/PostgREST/Storage 上的管理员与双用户隔离、权益/流水拒写、消息事务、跨用户关联拒绝、向量非有限值与维数错误、社区拒绝、头像跨用户拒绝、限流 N/N+1 及备份恢复。
- 历史外键的生产删除动作并不全在 context export 中；仅恢复本文件列出的有来源级联，其他保持 export 的严格外键。跨多个历史绑定的删除可能按约束拒绝，不应自动追加全局 CASCADE。

## 集成项

无需修改根 `package.json` 即可运行上述命令；可由父流程添加独立 `test:selfhost-schema` 入口。当前 `.gitignore` 未忽略这三个新增 SQL 文件，无需为本补丁修改忽略规则。Compose/启动器需遵循上述角色、事务、阶段、指纹与限流 migration 顺序。本目录不修改主 Compose、`.env` 或生产配置。
