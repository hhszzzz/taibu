# 本地 Docker 自托管原型

## 适用范围

这是从 Vercel＋托管 Supabase 迁往自有基础设施的**第一阶段本地原型**，不是已经上线的生产方案。应用仍是 Next.js 模块化单体，Core/MCP 包边界不变。

- 已将 Web、PostgreSQL/pgvector、Redis、Auth、PostgREST、头像 Storage、向量函数和提醒调度装配到本地容器。
- Agent 使用与 Web 相同的镜像运行常驻 `worker`，新空库基线增加任务表和租约 RPC。工具、凭据、功能开关及部署说明见 [Agent](Agent.md)。只有经哈希审定的旧基线可应用指定增量迁移。
- 先解除托管平台运行依赖，保留 Supabase 协议兼容层；没有同时重写身份系统和所有查询。
- `--demo` 是明确标注的确定性模型服务，用于验证真实 HTTP、SSE、计费和保存，不代表真实 AI 推理质量。不调用付费供应商。
- 不复制生产账号/业务数据，不读取项目真实 `.env`，不自动部署或修改 DNS。
- **社区暂不开放**：本地历史材料不足以证明计数触发器和审核语义；保留表但关闭特性/权限。不要通过取消 RLS 绕过。
- OAuth、外部邮件、真实模型、公开 TLS、服务器容量、生产迁移尚需下一阶段单独验证。

部署形态参考相邻 New API 仓库的本地 `docker-compose.yml`、`docker-compose.dev.yml` 和多阶段 Dockerfile；没有复制它的 Go/GORM、示例密码或浮动版本策略。

## 启动与体验

前置：本机 Unix-socket Docker、Docker Compose、Node.js 22.19+、pnpm。镜像固定 Node 24.21.0 / pnpm 10.33.0；首次安装/构建需要访问镜像和依赖仓库，运行 demo 不需要外部模型或托管数据库。

```bash
pnpm install --frozen-lockfile
pnpm selfhost init --demo
pnpm selfhost up
```

访问 `http://127.0.0.1:3080`。账号信息在 `.taibu-local/taibu-local/credentials.json`，文件权限 0600，目录 0700；包含两名普通用户和一名系统管理员，密码随机生成。输入**完整邮箱**即可登录，无需使用固定邮箱后缀。不能把文件内容贴到 issue/PR。

```bash
pnpm selfhost status
pnpm selfhost logs       # 受控状态/严重程度计数，不打印原始日志或密钥
pnpm selfhost down       # 删除当前项目容器/网络，保留持久卷
pnpm selfhost up         # 重启，不重置账号/密码/数据
pnpm selfhost up --build # 修改应用或公开构建配置后重建镜像
```

独立项目：`pnpm selfhost init --project taibu-preview --port 3082 --demo`，后续命令都携带相同 `--project`。`init` 拒绝覆盖既有配置；不要手工改一份 `compose.env` 而不改配置契约。同一 hostname 的 Cookie 不按端口隔离，同时比较多个本地项目时使用独立浏览器 profile，不能把不同端口当作会话隔离。

CLI 校验本地 Docker endpoint、私有配置及资源实例标签，拒绝远程 Docker、同名陌生容器/网络/卷和不匹配的数据库基线。仅通过 CLI 操作这套原型，不能直接运行会自动读取 `.env` 的裸 Compose 命令。原 `docker-compose.yml`、Web/MCP 独立 Compose 继续服务原来的外部后端部署，不被自动覆盖。

### 固定通用测试栈（3196）

本工作区后续统一使用已有 `taibu-agent-1006b` 项目作为通用测试栈，访问 `http://127.0.0.1:3196`。保留原项目名以继续使用已有账号、命盘、记录和持久卷。它包含完整的 Web、worker、认证、数据库、存储、网关等服务，不限于 Agent 测试。

```bash
pnpm local:update # 重建 Web / worker 等应用服务，在同一个项目更新
pnpm local:up     # 启动既有服务与镜像
pnpm local:status
pnpm local:logs
pnpm local:showcase # 清空演示账号的对话与 Agent 自动保存的记录，再重建演示对话
```

`local:showcase` 只作用于本栈的演示账号（先核对数据库容器的实例标签），需要启用 demo 模型。它取消进行中的任务、逐个走删除对话的正式接口，删除带 Agent 标签的命理记录和未设为默认的「Agent 八字/紫微命盘」，额度不足 60 时在本地库补足，然后按 `scripts/selfhost/demo.mjs` 的 SHOWCASE 场景依次发起真实 Agent 任务：八字多步详查、紫微、奇门、六壬与六爻对照、占星与择日、三名成员（各用一个演示模型）的协作会诊、补充信息（停在等待回答）、合婚对比与一条普通对话。盘面与详查都是真实计算，解读文字是预置示例，结尾注明来源；每步调用前的说明同样只写工具返回里的事实。演示账号里有等待回答的任务时，`agent-selfhost-browser.mjs` 的协作夹具会拒绝运行，先取消该任务，验收后再执行一次 `local:showcase`。验收脚本跑完会删除自己创建的对话，`--keep` 可保留。

对话与 Agent 会话不互通：在普通对话方式下打开 Agent 会话的链接会回到新建页，先切到 Agent 方式再打开。

这些命令包装已有 `selfhost` CLI，继续执行所有权和数据库基线校验。不会重新初始化配置或删除数据卷。凭据位于 `.taibu-local/taibu-agent-1006b/credentials.json`。当前启用了确定性 demo 模型；真实模型与联网搜索需要单独配置，不能用 demo 回复衡量推理质量。

本次更新将既有 Agent 测试基线升级至 `20261007_100000_agent_chat_results.sql`，迁移内容与目标基线均校验 SHA-256，并与本地版本标记在同一事务提交。普通代码更新的调用行号不再影响数据库指纹；实际 SQL／引导契约变化仍需审定。升级前备份保存在私有目录 `.taibu-local/agent-ui-backup-20261007/`。

## 拓扑、身份与数据

| 服务 | 职责 | 持久化/暴露 |
|---|---|---|
| gateway | 固定路径转发；替换伪造转发头；直接传递 SSE | 唯一宿主入口，默认 loopback |
| web | 生产模式 Next standalone | 非 root；不持有 PG owner 连接 |
| worker | Pi Durable 执行、工具调用、检查点与命盘成果结算 | 无宿主端口；管理员登录身份；复用应用环境和镜像 |
| db | PostgreSQL、pgvector、RLS、事务 RPC、Auth/Storage 元数据 | `database` 命名卷，不映射端口 |
| auth / rest | 真正的会话、JWT 校验与 PostgREST | 内部网络 |
| redis | 共享固定窗口限流 | 密码认证、AOF、128MB 上限、noeviction；内部网络 |
| storage | 头像内容与对象权限 | `storage` 命名卷；通过网关访问 |
| functions | 复用既有向量索引函数 | 预缓存 Deno 依赖；内部秘密鉴权 |
| scheduler | 每小时调用既有提醒接口 | 不复制提醒业务逻辑 |
| demo | 本地 OpenAI 兼容流式演示 | 可选 profile，无真实供应商请求 |

应用系统管理员仍然是 **authenticated 角色下的管理员登录 JWT**，不是 PostgreSQL owner，也不是真正 service_role。Auth 管理密钥仅用于既有 Auth 管理入口；不能转为普通用户数据库客户端。

向量维护角色独立于应用，拥有 `knowledge_entries` 单表，以及 PostgreSQL 创建索引要求的 `public` schema CREATE 权限。因此它是**可信 DDL 维护身份**，有创建 schema 对象的能力，不是“只能创建一个索引”的沙箱；凭据只注入函数容器，不授予普通 API 角色。Storage 建库所需数据库 CREATE 权限只在首次迁移阶段临时授予，完成/失败均撤销，后续启动清理遗留授权。

数据库初始化采用 `supabase/selfhost/` 的来源清单、完整表/视图与选定最终 RPC，不全量回放历史 SQL。详见 [基线说明](../../supabase/selfhost/README.md)。所有表/视图有显式权限边界；本地作者定义的策略和兼容修订不冒充生产导出。初始化和追加限流修复在同一事务；已有数据卷只接受审定的增量升级，未知指纹仍拒绝。

## 环境与兼容规则

主变量在 `.env.example`：

- `SELF_HOSTED`：启用自托管模式，同时关闭 Vercel Analytics。
- `APP_ORIGIN`：浏览器应用 origin。CLI 仅生成 loopback HTTP。
- `SUPABASE_URL`：服务间网关地址；`SUPABASE_PUBLIC_URL`：浏览器可访问地址，防止头像指向容器 hostname。
- `AUTH_ALLOW_INSECURE_LOCAL_HTTP`：仅明确自托管且配置精确 loopback HTTP origin 时生效。不会根据请求 Host 降低 Cookie 安全性；托管生产仍保留 Secure。
- `REDIS_URL`：服务端专用；限流、共享缓存与后台任务队列只使用 Redis，不再有 `RATE_LIMIT_BACKEND` 开关。
- `AGENT_CREDENTIAL_ENCRYPTION_KEY`：Web/worker 共用的 32 字节标准 Base64 任务密钥；新项目自动生成。`TAVILY_API_KEY` 为空时关闭联网；`AGENT_WORKER_CONCURRENCY` 控制单 worker 并发。

`SELF_HOSTED`、`SUPABASE_PUBLIC_URL` 同时影响构建和运行，变更需 `up --build`。镜像不接收 Auth/供应商秘密 build args。多个不同公开 origin 的部署应分别构建/标记镜像，不能假定同一个 `:local` 镜像内的图片白名单会随运行环境自动更新。头像使用直接 URL，不开启 Next 图片优化器的任意内网访问。

Redis 存限流状态、共享缓存与 BullMQ 任务队列，不存积分余额或替代业务事务。窗口内允许配置的最大次数，拒绝不延长窗口；后端故障继续原来的 **fail-open**，有界超时且不重试可能已执行的扣槽命令，不切换到另一份独立计数器。这个可用性选择不等于强制防滥用保障；生产策略需单独评估。

生成的本地 JWT/密码需要与持久卷一起保管。CLI 不是生产密钥轮换工具；不能通过删除配置文件重新生成秘密后接回旧卷。

## 备份与恢复

备份会短暂停止该项目除数据库外的服务，取得一致的数据库/文件快照后重新启动；不影响其他 Docker 项目。备份包含用户数据和秘密，不能提交或上传公开仓库。

```bash
pnpm selfhost backup --output /absolute/private/path/new-backup-directory
pnpm selfhost restore --input /absolute/private/path/new-backup-directory \
  --target taibu-restored --port 3081
pnpm selfhost up --project taibu-restored
```

目标目录和恢复项目必须不存在，端口必须与来源不同。恢复只允许本工具生成且校验一致的当前版本备份；拒绝复用来源资源或覆盖已有数据。恢复失败保留阻断标记，不把半恢复状态当作可运行库。

除数据库和对象内容，Storage 文件后端还依赖扩展属性；不能使用只保留普通文件的 tar 作为完整备份。当前 **v2** 格式通过校验过的 `storage-attributes.json` 保留文件/目录清单及两项 Storage 属性，恢复时核对实际文件集合并回读验证；不恢复任意系统扩展属性。旧 v1 备份不完整，已明确拒绝，必须重新备份。归档校验保留安全 GNU 长文件名支持，但拒绝链接、路径穿越、非法校验和及未支持的 PAX 元数据。原型有 512MiB 级内存/归档上限，属性清单限 16MiB，不适用于大规模生产备份。Redis 临时计数不属于业务恢复数据。

目前升级能力是：相同基线可重启/恢复；应用改动可重建镜像。若只是调用代码哈希/行号改变而使来源清单指纹变化，只有经过审核的“旧完整指纹＋新完整指纹＋初始化 SQL 契约摘要”精确匹配才能复用旧卷或 v2 备份；SQL 仅忽略来源 `COMMENT`，平台角色与维护授权另行逐字核对。未知版本、SQL/权限变动仍拒绝，不重放初始化或改写旧卷版本标记。**真正的数据库基线变更没有自动原地升级入口**，必须另设计前向 migration、备份和演练，不能删除卷“升级”。

## 验收入口与已知限制

```bash
# 不启动服务的来源/配置/归档检查（也纳入默认测试）
node scripts/selfhost-schema.mjs
node --test scripts/tests/selfhost-schema.test.mjs scripts/tests/selfhost-stack.test.mjs

# 独立真实 Redis 回归（也纳入完整 verify）
node --require ./scripts/ts-register.cjs --test scripts/tests/selfhost-redis.test.mjs

# 已启动 --demo 本地栈后，真实 HTTP 和浏览器旅程；会写合成测试记录
node scripts/tests/selfhost-live.mjs --project taibu-local
node scripts/tests/selfhost-browser.mjs --project taibu-local --chrome
# 仅验证命盘即时同步，不调用演示模型；创建临时命盘后清理并恢复之前的默认设置
node scripts/tests/selfhost-browser.mjs --project taibu-local --chrome --sync-only
node scripts/tests/agent-selfhost-browser.mjs --project <独立演示项目> --chrome
# 去掉 --chrome 使用已安装的 Playwright Chromium

# 重启后验证上次保存的历史、头像及归属（不重新生成记录）
node scripts/tests/selfhost-live.mjs --project taibu-local --check-persisted

pnpm verify -- --chrome
```

真实浏览器不 mock Auth、数据库或应用 API；只阻止意外外部请求。模型是显式 demo 服务。`browser-acceptance.png` 和 `chart-sync-acceptance.png` 保存在项目私有目录，证明浏览器实际交互，不替代所有页面/真机/生产浏览器测试。命盘同步旅程先打开并保留管理面板，再通过 SPA 导航新增/编辑、设置默认和删除，检查列表、选择器、月运及聊天数据源；不能用整页刷新或等缓存过期代替通过。

本轮已验证空库启动、真实登录、塔罗流式保存/扣费、跨用户拒绝、头像上传下载、全文/向量检索及索引维护、提醒并发防重复和实际浏览器历史恢复。双 Web 副本预热后 40 次并发直连准备请求得到 20 次成功、20 次 429；首次并发轮曾出现一次 503，未据此宣称完成生产压测。

### 2026-10-04 首轮本地验收（同步修复前）

在不含真实 `.env`、运行数据和旧产物的源码副本中完成 frozen/offline 安装，从包构建开始执行 `pnpm verify -- --chrome`，没有跳过层级：

| 验收层 | 结果 |
|---|---|
| 三个包构建、lint/架构守卫、strict、Next 生产构建 | 全部通过 |
| 默认单元/路由/协议/工程检查 | 1295/1295 |
| 包、许可证与 Skill 产物 | 20/20 |
| 隔离 PostgreSQL/RLS/事务 | 35/35 |
| 真实 Auth/PostgREST | 21/21 |
| 独立真实 Redis 并发/边界/故障 | 1/1 组合测试 |
| 既有离线浏览器组件层 | 54 项检查，117 个 fixture 请求 |
| 生产镜像上的实际 HTTP 综合验收 | 7/7（含外层测试） |
| 实际浏览器 | 登录→抽牌→流式保存→历史恢复，通过；零额外推理、外部请求和运行时异常 |
| v2 备份恢复到独立项目 | 3/3：真实登录、历史/归属、头像内容读取 |
| 来源项目保留卷后重启 | 登录、历史/归属与头像复验通过 |

所有上述测试层零失败、零跳过。验证副本与工作区 1181 个源码/配置/测试文件摘要一致，后续仅补结果文档；不使用旧提交 CI 代替本轮证据。

恢复演练真实发现并修复普通 tar 丢失 Storage 属性、GNU 长文件名被误拒绝，以及相似项目前缀被误当成同一资源的问题。失败的旧 v1 测试备份和恢复测试栈已清理，仅保留可体验的本地栈与私有 v2 备份。上述测试范围内置信度高；社区、真实外部集成、所有领域完整业务等价性和生产压测不在通过声明内。未提交/推送、未执行线上迁移或部署。

### 2026-10-05 保存后即时同步复核

本轮真实复现了两条旧行为：保存接口已返回成功、数据库已含新命盘，但重新打开保活的命盘面板仍没有新记录；聊天数据源索引预热后离开页面、保存并在 15 秒内返回，仍命中旧服务端索引。现已统一命盘 Query 数据源和写入副作用，并修正提及/历史/记录读取的过期响应与账号切换边界。

为避免混入同期独立 Core 算法改动，本轮运行镜像从“上一轮已验收原型＋本次同步修复”的冻结副本构建，Core 沿用 `5725dde`，未覆盖工作区中的独立改动。`pnpm verify -- --chrome` 从包构建开始完整执行，未跳过层级：

| 验收层 | 本次结果 |
|---|---|
| 包构建、lint/架构守卫、strict、Next 生产构建 | 通过 |
| 默认单元/路由/协议/工程检查 | 1310/1310 |
| 包、许可证与 Skill 产物 | 20/20 |
| 隔离 PostgreSQL / Auth-PostgREST / Redis | 35/35、21/21、1/1 |
| 离线真实组件同步回归 | 84 项检查，279 个 fixture 请求；零外部请求和运行时异常 |
| 实际生产镜像浏览器 | 八字/紫微新增和编辑、保活列表、默认切换、选择器、删除后回退、聊天提及索引均通过；命盘流程未整页刷新 |
| 原塔罗流程及实际 HTTP 综合验收 | 浏览器流式保存/历史恢复通过；HTTP 7/7 |
| 原数据卷备份后重启 | 登录、历史/归属、头像 3/3；浏览器命盘同步再次通过 |
| 旧指纹 v2 备份恢复到隔离项目 | 3/3，通过精确等价校验；未改原卷版本标记 |

冻结副本记录了 1192 个源码/配置/测试文件摘要；应用同步源码与通过验收的副本一致。完整 verify 后只调整了真实浏览器验收脚本的 DOM 定位、失败诊断和临时数据清理保护，并以最终脚本重复通过实际流程；结果文档随后补充。

保留本地入口 `http://127.0.0.1:3080`、原数据卷、私有 `backup-sync-20261005/` 备份和 `taibu-local/sync-build.json` 镜像来源记录；临时恢复项目及其三个卷已经按实例标签检查后清理。已有浏览器页面需先刷新一次加载新前端，之后保存不需要靠手动刷新列表。

**范围限制与单独失败记录：**
- 最近一次包含同期 Core 改动的工作区快照：1349 项默认测试、lint/strict 和 Web 构建通过，但 Skill 工具清单/冻结输出对应的 16 项产物检查失败；该快照的浏览器 84 项检查另行通过。没有修改那批 Core 代码或通过删除断言掩盖差异，也不将本轮隔离通过结果称为整个当前工作区通过。直接从工作区再次 `up --build` 会纳入那些独立改动，应先完成其产物同步和验收。
- 镜像更新后的首次浏览器操作曾等待登录入口超时，随后页面检查及多次完整/重启后流程正常，未定位该首次超时根因；冷启动稳定性和生产压测不在通过声明内。真实 DOM 断言中还修正了搜索结果带类型前缀、记录标题与正文同名的测试定位问题，这些不冒充应用缺陷。
- 未提交、推送或更新远程 PR；没有线上迁移、部署或停用托管平台。社区和真实外部集成的上一轮限制不变。

## 生产迁移后续门槛

1. 指定服务器与独立预发布环境，确认资源、端口、防火墙、TLS、可信反代、日志保留和升级策略。
2. 核对生产 schema/权限/扩展及 Auth、文件、OAuth、邮件依赖；不能把本地来源清单当作完整生产等价证明。
3. 演练用户 ID、密码、会话、对象文件、头像 URL 的迁移及备份恢复；验证会员/积分/流水对账。
4. 确定停写窗口、增量同步、旧调度停止顺序、流量切换与回滚。新库开始写入后，不能仅切回旧连接串。
5. 另行批准上线。当前草稿 PR 不自动合并，Vercel 和托管 Supabase 不停用。
