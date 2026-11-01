# 本地与自托管栈（Docker + PostgreSQL + Redis）

## 适用范围

应用以自有 PostgreSQL、Redis、SMTP 和文件卷运行。应用仍是 Next.js 模块化单体（`output: 'standalone'`），Core/MCP 包边界不变。

- 认证使用 Better Auth（`identity` schema），数据访问统一走 Kysely 的受控 `ScopedDb`。
- 文件写入本机卷（`/data/files`），由本机卷持久化。
- 限流、登录失败锁、会话二级存储和 BullMQ 队列使用 Redis。
- PostgreSQL 17 + pgvector 由 `database/bootstrap/` 与 `database/*.sql` 管理。
- 本文统一描述本地与生产运行方式，不保留一次性基础设施切换记录。

## 前置

- 本机 Unix-socket Docker（OrbStack / Docker Desktop / Docker Engine）
- Docker Compose v2.20+（本地验证版本 v5）
- Node.js 24.22.1、pnpm 10.33.0
- 首次构建需要访问镜像仓库与 npm registry

## 启动

```bash
pnpm install --frozen-lockfile
pnpm local:update
```

首次运行自动生成配置并构建、启动全部服务，数据库 SQL 自动执行。默认访问 `http://127.0.0.1:3080`；实际端口以 `pnpm local:status` 为准。邮件由 Mailpit 捕获，默认界面在 `http://127.0.0.1:8025`；注册、登录验证码和找回密码都从这里读取。

首次启动顺序由 Compose 保证：

1. `db` 健康；
2. `db-setup` 执行 `database/bootstrap`（角色、schema、扩展、角色密码）；
3. `db-init` 应用当前 SQL 定义；
4. `web` 与 `worker` 启动。

`web` 与 `worker` 共用同一个镜像；`worker` 同时消费 Agent 任务和 BullMQ 的维护、邮件与 Agent 测评队列。

根目录 `Dockerfile` 构建这个应用镜像；`deploy/compose.*.yml` 定义镜像与 PostgreSQL、Redis、文件卷等服务如何一起运行。`deploy/deploy.sh` 封装生产备份、更新和健康检查，本地入口仍是 `pnpm local:update`。根目录 `docker-compose.mcp.yml` 用于单独运行 MCP Server，与网站栈分别启动。

## 常用命令

```bash
pnpm local:up          # 启动 taibu-v2（镜像已存在时直接启动）
pnpm local:update      # 重新构建镜像并滚动更新 web/worker
pnpm local:status
pnpm local:logs        # 最近日志，凭据与连接串会被脱敏
pnpm selfhost down --project taibu-v2
pnpm selfhost backup --project taibu-v2 --output ./backups/taibu.dump
pnpm selfhost restore --project taibu-v2 --input ./backups/taibu.dump
```

根目录 `backups/` 已同时从 Git 和 Docker 构建上下文排除，备份应保存在私有目录。

独立项目：`pnpm selfhost init --project taibu-preview --port 3082`，后续命令携带相同 `--project`。`init` 拒绝覆盖既有配置。不同项目使用独立 Docker 网络、卷和 0700 配置目录。

## 数据库

`database/` 直接保存当前 PostgreSQL SQL，不保留编号迁移或版本账本。

SQL 是创建空库及更新数据库对象的源码。搬迁已有数据库时，完整的 `pg_dump -Fc` 备份会携带表、数据、函数、触发器、权限及索引定义，`pg_restore` 会据此重建索引，不需要手工逐条建索引。只导出 CSV 或使用 `--data-only` 则不包含这些结构。集群角色、扩展安装和文件卷仍需在目标环境准备；数据库备份不能代替文件卷备份。

| 文件 | 内容与执行方式 |
| --- | --- |
| `bootstrap/` | 超级用户建立角色、schema、扩展与角色密码 |
| `schema.sql` | 表、序列和约束，仅用于全新空库 |
| `functions.sql` | 函数与视图；未在此声明的函数/视图会被删除 |
| `triggers.sql` | 当前触发器定义 |
| `access.sql` | RLS、策略和明确的角色权限；未在此声明的权限会被撤销 |
| `seed.sql` | 系统主体与必须的数据不变量 |
| `indexes.sql` | 在事务外并发建立索引 |

```bash
pnpm db:bootstrap  # ADMIN_DATABASE_URL 和各角色密码，见脚本校验
pnpm db:init       # SCHEMA_DATABASE_URL，以 taibu_schema 登录后 SET ROLE taibu_owner
pnpm db:codegen    # --project taibu-v2，或 DATABASE_URL；生成 src/lib/db/generated
pnpm db:diff       # --a/--b 两个 DSN 的 public/identity/auth/extensions 结构与权限对比
pnpm db:verify-restore  # 在临时库验证备份：定义对比、用户一致性、FK
```

`db:init` 使用数据库锁串行执行，没有迁移账本。它把每个声明对象与 PostgreSQL 反解出的规范文本比较，只应用差异：全新库先创建表，再应用其余 SQL；已有库替换变化的函数与视图、重建变化的策略与触发器、按规范文本新建或重建索引、补齐声明权限并撤销未声明权限，然后删除文件不再声明的函数、视图、策略、触发器与索引。业务数据保持不变。每段 DDL 在独立短事务中执行并带锁超时，部署时正在服务的旧版本不会被长时间阻塞；没有变化的一轮不会写入系统目录。

**表与列的结构不会被隐式修改。** 已有库与 `database/schema.sql` 不一致时，`db:init` 在改动任何对象之前失败并逐条列出差异；增加列、改变类型、修改约束需要维护者先备份并执行明确的 `ALTER`，然后同步当前定义。索引、策略、触发器、视图与函数定义由 `db:init` 自动收敛，删除表或列仍需显式 SQL。

宿主机操作需要 PostgreSQL 17 客户端；对比与恢复校验支持 `PG_DUMP_BIN` / `PG_RESTORE_BIN` / `PSQL_BIN` 覆盖路径。私有连接保存在 `.taibu-local/<project>/env/*.env`（0600）：DDL 连接是 `schema.env` 里的 `SCHEMA_DATABASE_URL`，登录角色 `taibu_schema`；它只能 `SET ROLE taibu_owner`，本身不是对象属主。

### 设为管理员

系统用户 `00000000-0000-4000-8000-000000000001` 不能登录。先用页面注册自己的账号，再执行：

```bash
docker compose \
  --project-directory . \
  --env-file .taibu-local/taibu-v2/compose.env \
  -f deploy/compose.base.yml -f deploy/compose.local.yml -p taibu-v2 \
  exec -T db psql -U postgres -d taibu \
  -c "set role taibu_owner; update public.users set is_admin = true where id = (select id from identity.users where email = 'you@example.com');"
```

### 接入模型

模型目录、网关地址和网关密钥都保存在数据库里，不读取环境变量。设为管理员后，在设置中心「AI 服务」先到「网关管理」添加网关：填写 OpenAI 兼容地址与密钥，可以当场测试连接并读出网关上的模型。再到「模型管理」添加模型：可选一个 lobehub 图标（不选时跟随供应商，输入框的模型菜单里显示），选择上下文窗口（预设或自定义）与输出上限（留空按上游模型默认），勾选模型支持的思考等级，填写单价，然后按故障转移顺序选择来源网关。模型编辑器会按模型 ID 自动查询 models.dev 的公开目录：精确命中时只补还空着的字段，结果里的「填入」用目录值（含单价）覆盖表单；模型列表的「从 models.dev 补全」逐个对话模型精确匹配，只补空缺的上下文、输出上限、思考等级与单价（图片输入不自动打开），目录价格全为 0 时不补单价，并列出未匹配与保存失败的模型。服务器连不上 models.dev 时（可用 `MODELS_DEV_API_URL` 指向镜像），这些值仍可手填，不影响保存。

网关密钥用 `AGENT_CREDENTIAL_ENCRYPTION_KEY` 派生的密钥加密，并绑定到所在的网关；界面只显示开头与末尾几位。更换 `AGENT_CREDENTIAL_ENCRYPTION_KEY` 后，已保存的网关密钥无法读取，需要逐个重新填写。

### 计费与在线支付

平台模型按单价计费：在「模型管理」给对话模型填写输入、输出单价（缓存读、缓存写可选，留空按输入价），单位是美元每百万 token；支持图片输入的对话模型同样按 token 计费；生图模型填每张图的单价。单价留空的模型不对用户提供，全填 0 为免费模型。新用户余额为 $0，先在设置中心「计费」建套餐、生成兑换码，或直接给用户加余额。

在线支付使用易支付（彩虹易支付 v1 协议，支付宝/微信），默认关闭。在 `.env` 填齐前三项并重启 web 后开启：

```dotenv
EPAY_API_URL=<商户网关地址，如 https://pay.example.com>
EPAY_PID=<商户号>
EPAY_KEY=<商户密钥>
EPAY_METHODS=alipay,wxpay   # 可选，默认 alipay,wxpay
```

- 支付金额为美元乘以「计费 → 设置」里的人民币汇率（默认 7.3），保留两位小数；充值档位与最低充值也在那里设置。
- 网关的异步通知地址是 `{APP_ORIGIN}/api/billing/epay/notify`，同步跳回 `{APP_ORIGIN}/api/billing/epay/return`，所以 `APP_ORIGIN` 必须是网关能访问的公网地址。两者都按 MD5 验签，只有 `TRADE_SUCCESS` 且金额与订单一致时入账，同一订单只入账一次。
- 两小时未支付的订单与到期的订阅由 worker 的 `billing-maintenance` 每 10 分钟处理。
- 不开启时，用户只能用兑换码、管理员加款或用余额购买套餐。商户密钥只放在服务器 `.env`，不要提交。

## 邮件

本地栈用 Mailpit 捕获邮件，不需要任何配置。生产必须接一个真实发信服务，否则注册验证码、验证码登录和找回密码都发不出去。

应用是 **SMTP 客户端**，不自建 MTA。所有服务商（Brevo、Resend、腾讯云、自建 Postfix）都走同一条 SMTP 通道，因此接入方式统一：

```ini
EMAIL_PROVIDER=<brevo|resend|tencent|custom|mailpit|log>
SMTP_USER=<中转登录名>
SMTP_PASS=<SMTP 密钥>
SMTP_FROM=<已验证发信域名下的地址>
```

`EMAIL_PROVIDER` 只负责预填主机、端口和加密方式；下面三类值需要你按服务商填写。预设之外的中转（自建 Postfix、企业内网 SMTP）用 `custom`，此时 `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` 全部按实际情况填。

配置在启动时校验，错误信息直接指出是哪一项不对，包括端口与 `SMTP_SECURE` 不匹配这种最常见的错配。

| `EMAIL_PROVIDER` | 主机 | 端口 | `SMTP_SECURE` | 说明 |
|---|---|---:|---|---|
| `brevo` | `smtp-relay.brevo.com` | 587 | `false` | STARTTLS |
| `resend` | `smtp.resend.com` | 465 | `true` | 隐式 TLS |
| `tencent` | 自行填写 | 465 | `true` | 广州 `gz-smtp.qcloudmail.com`、香港 `smtp.qcloudmail.com`、国际站 `sg-smtp.qcloudmail.com` |
| `custom` | 自行填写 | 自行填写 | 自行填写 | 自建 Postfix 等 |
| `mailpit` | `127.0.0.1` | 1025 | `false` | 本地捕获，不需要凭据 |
| `log` | — | — | — | 只写日志；`NODE_ENV=production` 下拒绝启动 |

显式填写 `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` 会覆盖预设，所以同一个 `EMAIL_PROVIDER` 也能指向备用中转。

### Brevo

在 Brevo 后台 **Settings → SMTP & API → SMTP** 页取三个值，它们各不相同，混用是 `535` 认证失败最常见的原因：

| 值 | 取自哪里 |
|---|---|
| SMTP 服务器 | 固定 `smtp-relay.brevo.com` |
| SMTP 登录名 | 页面上显示的 Login，形如 `1234567@smtp-brevo.com`（**不是** relay 主机名，也不一定是账号邮箱） |
| SMTP 密钥 | 点 **Generate a new SMTP key** 生成，只显示一次；**不是** API key，也不是账号密码 |

```ini
EMAIL_PROVIDER=brevo
SMTP_USER=1234567@smtp-brevo.com
SMTP_PASS=<生成的 SMTP 密钥>
SMTP_FROM=命理排盘 <noreply@mingai.fun>
```

`SMTP_FROM` 用 `显示名 <地址>` 的形式，收件人看到的是「命理排盘」而不是 `noreply`。只写地址也能发信，但多数邮件客户端会把 `noreply` 直接显示成发件人名称。

`SMTP_FROM` 的地址部分必须是已在 Brevo 验证过的发件人域名下的地址。发信额度与 DNS 验证要求以服务商当前控制台为准。

### 域名 DNS 记录

Brevo 用的是共享 IP，此时**不需要改 SPF**：发信信封的 Return-Path 落在 Brevo 自己的域名（`smtp-relay.sendinblue.com`）上，SPF 由 Brevo 那边通过；DMARC 对齐靠你自己域名的 DKIM 签名。只有开通独立 IP 才需要把 Brevo 加进 SPF。

在 Brevo 的 **Senders, Domains & Dedicated IPs → Domains** 里添加 `mingai.fun`，点 **Authenticate this email domain**，它会给出三条记录：

| 记录 | 用途 |
|---|---|
| Brevo code（TXT） | 证明域名归属 |
| DKIM 1（CNAME 或 TXT） | 签名密钥，selector 由 Brevo 生成 |
| DKIM 2（CNAME 或 TXT） | 第二个 selector |

**selector 名称以 Brevo 页面显示的为准**，不同账号可能给出 `mail._domainkey`、`brevo1._domainkey` 或 CNAME 指向 `*.dkim.brevo.com` 的形式。照抄页面上的「Name」和「Value」即可，不要套用别处的示例。

DMARC 已有就保持不动，先留在 `p=none` 观察；等 SPF/DKIM 都验证通过、报告里没有异常，再改成 `p=quarantine`。

**同一域名下可以并存多个 DKIM selector**（比如 Cloudflare 邮件路由的 `cf2024-1._domainkey` 和 Resend 的 `resend._domainkey`），互不冲突。唯一不能重复的是 SPF：一个域名只能有一条 SPF TXT，新增发送方必须合并进同一条。

域名验证通过前，Brevo 只允许发往账号本人邮箱，所以先验证域名再切生产。

### 验收

改完 `app.env` 后重启 `web` 与 `worker`，然后用一个真实邮箱注册一次，确认：

- 收件箱能收到验证码，且不在垃圾箱；
- 用验证码完成登录；
- 走一次「找回密码」流程。

BullMQ 的 `taibu-email` 队列失败计数可在 Redis 里查看；连续失败通常是 `SMTP_PASS`（用了 API key 而不是 SMTP 密钥）、`SMTP_USER` 填成了 relay 主机名，或发件域名尚未验证。

## 版本与镜像发布

应用版本号以根目录 `package.json` 为准：x 是重大架构变更，y 是功能新增，z 是问题修复。发布在本地准备、推送标签后由 CI 完成：

```bash
# 按上一个 v* 标签以来的提交生成 CHANGELOG.md 段落、更新 package.json，再提交并打注释标签；不会推送。
pnpm release prepare minor --dry-run   # 先预览版本号与更新说明
pnpm release prepare minor             # 也可以是 major、patch 或 1.0.0-rc.1 这样的明确版本
# 还没有 v* 标签时（首个版本），用 --from 指定更新说明的起点。
pnpm release prepare 1.0.0 --from <提交或标签>
# 核对 CHANGELOG.md 后推送分支与标签。
git push origin master v0.2.0
```

推送 `v*` 标签后，`.github/workflows/release.yml` 先确认标签与 `package.json` 的版本一致，再构建 `linux/amd64` 镜像并推送为 `ghcr.io/hhszzzz/taibu:<标签>`，正式版本同时更新 `latest`。镜像的 OCI 标签与索引注解写明标题、带版本号和更新说明链接的描述、源码仓库、许可证与本手册地址，GHCR 包页面据此显示描述并关联仓库。镜像推送成功后，工作流用该版本的 CHANGELOG 段落、拉取命令和镜像摘要创建 GitHub Release，预发布版本标为 Pre-release。

更新说明来自 Conventional Commits：`feat`、`fix`、`perf`、`refactor`、`docs` 各成一栏，`chore`、`build`、`ci` 归入维护，`test`、`style` 不写入。带 `!` 或 `BREAKING CHANGE:` 脚注的提交排在最前面的「升级须知」；需要手动执行 SQL、重新填写配置的变更必须这样标记，并把完整步骤写进提交说明。

其他架构的主机在 Actions 页面手动运行 release 工作流，填写已有标签并选择架构，得到 `v0.2.0-arm64` 这样的镜像，不会移动正式标签和 `latest`。部署时 `compose.env` 的 `TAIBU_IMAGE` 指向 `ghcr.io/hhszzzz/taibu`，再执行 `deploy/deploy.sh <标签>`。

## 生产部署与备份

生产使用 `deploy/compose.base.yml` + `deploy/compose.prod.yml`，私有配置写入 `/opt/taibu/env/`。`compose.env` 保存项目名、镜像、tag、域名及 `TAIBU_ENV_DIR`；账号口令按 `app.env`、`db.env`、`db-setup.env`、`schema.env`、`backup.env`、`restore.env` 拆分。部署使用 CI 构建好的镜像。

```bash
# 在主机源码目录执行；已有宿主反向代理时使用 host。
EDGE_MODE=host deploy/deploy.sh <tag>
# 由 Compose 的 Caddy 接管 80/443 时使用 container（默认）。
EDGE_MODE=container deploy/deploy.sh <tag>
```

`host` 模式叠加 `compose.host-edge.yml`，Web 只发布回环端口；`container` 模式启动 Caddy 的 `edge` profile。TLS、域名、代理真实 IP 与上传限制以 `deploy/Caddyfile`（容器边缘）或 `deploy/Caddyfile.host`（宿主 Caddy 模板）为准；`deploy/update-cloudflare-ips.sh` 从 Cloudflare 官方列表刷新 `trusted_proxies`，改完需自行 validate + reload。

发布脚本先备份运行中的 PostgreSQL（默认保留最近 10 份 `pre-*`），再执行 `files-init`、`db-setup` 与 `db-init`，成功后更新 Web / worker 并检查 `/api/health/ready`；启动失败或健康检查超时会把 Web / worker 退回 `compose.env` 中记录的上一版本。数据库定义已由 `db-init` 收敛，回到更早版本需要恢复发布前备份。准备表结构变更时需把前述显式 SQL 操作纳入发布顺序；切换镜像 tag 不会撤销已经执行的结构变更。

`deploy/backup/` 按整点备份 PostgreSQL 和文件卷（当天首份成功备份即成为当日副本，可选同步到异地 restic 仓库）。`db:verify-restore` 或生产 `restore-check` 工具在独立临时库恢复备份，并把还原出的定义与当前 `database/*.sql` 逐项比较（表与列、策略、触发器、视图、索引、函数名与 RLS），再校验用户一致性与外键；使用较早版本镜像产生的备份可以加 `--no-schema` 跳过定义比较。该校验使用 `--no-owner --no-privileges`，不验证业务角色权限。恢复业务环境前停止写入，使用匹配的数据库、文件备份和镜像，并恢复对象属主与权限。

- `deploy/postgres/postgresql.conf`：数据库资源配置。
- `.taibu-local/<project>/`：本地私有配置、env 与 Compose 插值文件。
- `/opt/taibu/backups/` 与 Compose `backups` 卷：发布前备份和定时备份，分别管理保留策略。

## 安全边界

- 只有 `web` 的 3000 端口映射到 `127.0.0.1`；db/redis 不对宿主发布端口（本地 db 仅回环供 codegen）。
- `taibu_app` 是 NOINHERIT 零权限角色；每个事务显式设置 `role` 与 `request.jwt.claims`，缺少上下文时直接失败。
- `taibu_auth` 只能访问 `identity` schema，供 Better Auth 专用连接池。
- DDL 初始化使用 `taibu_schema` 登录后 `SET ROLE taibu_owner`；`taibu_owner` 不对外登录。

- 策略、触发器和权限由 `db:init` 收敛；仓库里不再声明的对象会被删除，因此不要在数据库中手工创建同名对象。
- 不要把 `.taibu-local`、`.env` 或备份文件提交到仓库。
