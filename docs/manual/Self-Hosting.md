# 本地与自托管栈（Docker + PostgreSQL + Redis）

## 适用范围

这是 Vercel + 托管 Supabase 迁往自有基础设施后的运行方式。应用仍是 Next.js 模块化单体（`output: 'standalone'`），Core/MCP 包边界不变。

- 认证使用 Better Auth（`identity` schema），数据访问统一走 Kysely 的受控 `ScopedDb`。
- 文件写入本机卷（`/data/files`），不再使用 Supabase Storage。
- 限流、登录失败锁、会话二级存储和 BullMQ 队列使用 Redis。
- PostgreSQL 17 + pgvector 由 `database/bootstrap` 与 `database/migrations` 管理。
- 本文只描述本地栈；生产主机、TLS、备份与切换步骤见 [切换运行手册](Cutover.md)。

## 前置

- 本机 Unix-socket Docker（OrbStack / Docker Desktop / Docker Engine）
- Docker Compose v2.20+（本地验证版本 v5）
- Node.js 24.22.1、pnpm 10.33.0
- 首次构建需要访问镜像仓库与 npm registry

## 启动

```bash
pnpm install --frozen-lockfile
pnpm selfhost init --project taibu-v2 --port 3080
pnpm selfhost up --project taibu-v2 --build
```

访问 `http://127.0.0.1:3080`。邮件由 Mailpit 捕获，界面在 `http://127.0.0.1:8025`；注册、登录验证码和找回密码都从这里读取。

首次启动顺序由 Compose 保证：

1. `db` 健康；
2. `db-setup` 执行 `database/bootstrap`（角色、schema、扩展、角色密码）；
3. `migrate` 执行 `database/migrations`；
4. `web` 与 `worker` 启动。

`web` 与 `worker` 共用同一个镜像；`worker` 同时消费 Agent 任务和 BullMQ 的维护、邮件队列。

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

独立项目：`pnpm selfhost init --project taibu-preview --port 3082`，后续命令携带相同 `--project`。`init` 拒绝覆盖既有配置。不同项目使用独立 Docker 网络、卷和 0700 配置目录。

## 数据库

```bash
# 在宿主上连接容器内的数据库
pnpm db:status    # 需要 MIGRATOR_DATABASE_URL
pnpm db:migrate   # 只向前；校验 sha256，已应用文件变化会拒绝执行
pnpm db:codegen   # 从 pg_catalog 重新生成 src/lib/db/generated
pnpm db:schema    # 从已迁移库重新生成 database/schema.sql
pnpm db:schema:check  # CI：快照与迁移结果不一致时失败
pnpm db:diff      # --a/--b 两个 DSN 的 public schema 漂移报告
pnpm db:verify-restore  # 恢复备份到临时库并校验迁移、用户一致性、FK 孤儿
pnpm db:transit   # 从只读生产快照构建 transit 并重放待上线迁移
```

`db:transit` / `db:diff` / `db:verify-restore` 需要 PostgreSQL 17 客户端（`PG_DUMP_BIN` / `PG_RESTORE_BIN` / `PSQL_BIN` 可覆盖路径），生产演练步骤见 [切换运行手册](Cutover.md)。

本地连接信息在 `.taibu-local/<project>/env/*.env`（0600）。迁移脚本在 `database/migrations/NNNN_name.sql`；新增结构必须写新迁移，不能改已应用文件。

### 设为管理员

系统用户 `00000000-0000-4000-8000-000000000001` 不能登录。先用页面注册自己的账号，再执行：

```bash
docker compose \
  --project-directory . \
  --env-file .taibu-local/taibu-v2/compose.env \
  -f deploy/compose.base.yml -f deploy/compose.local.yml -p taibu-v2 \
  exec -T db psql -U postgres -d taibu \
  -c "update public.users set is_admin = true where id = (select id from identity.users where email = 'you@example.com');"
```

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
| `brevo` | `smtp-relay.brevo.com` | 587 | `false` | 免费版 300 封/天 |
| `resend` | `smtp.resend.com` | 465 | `true` | 免费版 100 封/天 |
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
SMTP_FROM=noreply@mingai.fun
```

`SMTP_FROM` 必须是已在 Brevo 验证过的发件人域名下的地址。免费版每天 300 封；按现有用户量（708 人、近 30 天活跃 103）足够，超限时 Brevo 会拒发而不是扣费。

### 域名 DNS 记录

在 Brevo 的 **Senders, Domains & Dedicated IPs → Domains** 里添加 `mingai.fun`，它会给出要加的记录。送达率主要取决于这些记录，缺一条就可能进垃圾箱：

```dns
mingai.fun                       TXT  "v=spf1 include:spf.brevo.com -all"
mail._domainkey.mingai.fun       TXT  "v=DKIM1; k=rsa; p=<Brevo 给出的公钥>"
brevo._domainkey.mingai.fun      TXT  "v=DKIM1; k=rsa; p=<Brevo 给出的公钥>"
_dmarc.mingai.fun                TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@mingai.fun"
```

DKIM 的选择器与公钥、SPF 的 `include:` 值都以 Brevo 页面实际显示的为准——不同时期开通的账号给出的记录条数可能不同。

**已有 SPF 记录不能重复添加。** 若 `mingai.fun` 已有 SPF（例如 Cloudflare 邮件路由留下的 `include:_spf.mx.cloudflare.net`），要把 `include:spf.brevo.com` 合并进同一条记录；两条 SPF 记录会让校验直接失败。

域名验证通过前，Brevo 只允许发往账号本人邮箱，所以先验证域名再切生产。

### 验收

改完 `app.env` 后重启 `web` 与 `worker`，然后用一个真实邮箱注册一次，确认：

- 收件箱能收到验证码，且不在垃圾箱；
- 用验证码完成登录；
- 走一次「找回密码」流程。

BullMQ 的 `taibu-email` 队列失败计数可在 Redis 里查看；连续失败通常是 `SMTP_PASS`（用了 API key 而不是 SMTP 密钥）、`SMTP_USER` 填成了 relay 主机名，或发件域名尚未验证。

## 目录

- `deploy/compose.base.yml`：db、redis、db-setup、migrate、web、worker
- `deploy/compose.local.yml`：源码构建、回环端口、Mailpit
- `deploy/postgres/postgresql.conf`：2 vCPU / 2 GB 起点配置
- `database/bootstrap/`：超级用户执行的初始化
- `database/migrations/`：只向前的 schema 变更
- `.taibu-local/<project>/`：私有配置、env 文件、compose.env（0700/0600）

## 安全边界

- 只有 `web` 的 3000 端口映射到 `127.0.0.1`；db/redis 不对宿主发布端口（本地 db 仅回环供 codegen）。
- `taibu_app` 是 NOINHERIT 零权限角色；每个事务显式设置 `role` 与 `request.jwt.claims`，缺少上下文时直接失败。
- `taibu_auth` 只能访问 `identity` schema，供 Better Auth 专用连接池。
- 迁移使用 `taibu_migrator` 登录后 `SET ROLE taibu_owner`；`taibu_owner` 不对外登录。
- 不要把 `.taibu-local`、`.env` 或备份文件提交到仓库。
