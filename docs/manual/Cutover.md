# 切换运行手册（Supabase/Vercel → 自托管栈）

> 目标：计划内停机 ≤ 30 分钟；全员重登一次；历史消息可读；回滚窗口 T+60 分钟。
> 本手册只在 P7 主机就绪、P8 R2 彩排通过后执行。所有主机命令经 `ssh-mcp-server` 运行；密钥只从环境变量或 `/opt/taibu/env/*.env` 读取。

## 0. 待确认项（执行前必须填实）

| 项 | 值 |
|---|---|
| 规范主机 | `www.mingai.fun` / apex（二选一） |
| DNS / 代理 | 服务商；是否走 Cloudflare 代理 |
| ICP 备案 | 大陆地域必须已备案 |
| SMTP | 服务商、发信域名、SPF/DKIM/DMARC 状态 |
| 镜像仓库 | GHCR / 华为 SWR，及最终 tag |
| 异地备份 | restic 仓库与凭据保管方式 |
| 维护窗口 | `YYYY-MM-DD HH:mm`（Asia/Shanghai） |

## 1. Go / No-Go（全部满足才进入 P9）

- [ ] R2 彩排在 hw 上按本手册完整跑通，数据步骤（dump → transit → import → verify）≤ 15 分钟。
- [ ] `pnpm test:auth` 在 staging 通过；bcrypt `$2a$` 老密码可登录。
- [ ] OTP 邮件在 QQ、163、Gmail 收件箱均送达，且不在垃圾箱。
- [ ] Linux.do 登录与 `intent=membership-claim` 在 staging（或 mock）通过；生产回调地址保持 `/api/auth/linuxdo/callback`。
- [ ] `verify-restore` 对最近一次备份通过；回滚步骤已演练。
- [ ] 维护公告已写入 `announcements`；T−3d 已把 DNS TTL 降到 60–300 s。
- [ ] 终版镜像已推送；`/api/health/ready` 在 staging 返回 200。
- [ ] Vercel 环境变量已导出到密码管理器；Supabase 备份可用。

## 2. 环境准备（T−1d）

1. 确认 hw 上 `/opt/taibu` 已按 P7 建好：`env/*.env` 权限 600、属 root；`backups/`、`maintenance/` 存在。
2. 让新栈处于维护模式且数据库为空：
   ```sh
   touch /opt/taibu/maintenance/on
   docker compose --project-directory /opt/taibu/source --env-file /opt/taibu/env/compose.env \
     -f /opt/taibu/source/deploy/compose.base.yml -f /opt/taibu/source/deploy/compose.prod.yml \
     up -d --no-build
   ```
   `/api/health/ready` 应因数据库未导入而失败，这是预期状态。
3. 记录基线：`pg_stat_statements` 前 20、各表行数、磁盘与内存快照。
4. 在密码管理器里确认：`SUPABASE_SECRET_KEY`、`LINUXDO_CLIENT_SECRET`（仅用于确定性口令剔除）、`IMPORT_SOURCE_URL`、`IMPORT_TARGET_URL` 可用。
5. 确认 GitHub cron 仍启用：`gh workflow view reminders-cron.yml`。

## 3. 切换时间线（T+0 开始）

### T+0 切流

1. DNS / Cloudflare 源站指向 hw；用户看到维护页（503 + `Retry-After`）。
2. 在 Vercel 移除自定义域名，旧应用不可达；写入停止。
3. 停掉旧的定时提醒工作流（若它已随迁移分支删除，命令会失败，确认没有运行即可）：
   ```sh
   gh workflow disable reminders-cron.yml 2>/dev/null || true
   ```

### T+2 确认源库静止

只读查询 Supabase：

```sql
select count(*) from pg_stat_activity
where datname = 'postgres' and state = 'active' and query not ilike '%pg_stat_activity%';
select max(created_at) from public.conversations;
select max(created_at) from public.ming_records;
```

应用查询应为 0；热点表的 `max(created_at)` 在 2 分钟内不再变化。

### T+3 导出快照（只读）

在能同时访问 Supabase 与 hw 的导入机上：

```sh
mkdir -p /tmp/taibu-cutover
pg_dump "$SUPABASE_DB_DSN" -Fc --no-owner --schema=public --schema=supabase_migrations \
  -f /tmp/taibu-cutover/public.dump
psql "$SUPABASE_DB_DSN" -v ON_ERROR_STOP=1 <<'SQL'
\copy (select * from auth.users) to '/tmp/taibu-cutover/auth.users.csv' with (format csv, header true)
\copy (select * from auth.identities) to '/tmp/taibu-cutover/auth.identities.csv' with (format csv, header true)
\copy (select * from storage.buckets) to '/tmp/taibu-cutover/storage.buckets.csv' with (format csv, header true)
\copy (select * from storage.objects) to '/tmp/taibu-cutover/storage.objects.csv' with (format csv, header true)
SQL
```

要求客户端为 PostgreSQL 17（`pg_dump --version` ≥ 17）。Dump 与 CSV 只放在导入机的临时目录，完成后删除。

### 导入专用 DSN

`TRANSIT_TARGET_URL` 与 `IMPORT_TARGET_URL` 都要用 `postgres` 超级用户（或等价的 CREATEDB + BYPASSRLS 角色）：transit 需要建库/恢复，导入需要写全部表并在复制期间关闭触发器。它们只从密码管理器注入当前 shell，不写入任何文件。`taibu_migrator` 只用于 `migrate` 服务，不适合导入。

### T+5 构建 transit 并重放待上线迁移

在 hw 上（镜像内已带 `scripts/db`）：

```sh
docker compose ... run --rm --no-deps -e TRANSIT_TARGET_URL="$TRANSIT_TARGET_URL" \
  -v /tmp/taibu-cutover:/dump:ro web \
  node scripts/db/transit-build.mjs --dump /dump --recreate --report /tmp/transit.json
```

验收：`transit.json` 中 `validate migration state` 通过，28 个 pending 迁移全部 replay，`pg_restore` 只有白名单内的错误。

### T+8 迁移空库并导入

```sh
docker compose ... run --rm migrate                     # 全新 0001…0010
docker compose ... run --rm --no-deps \
  -e IMPORT_SOURCE_URL="$TRANSIT_TARGET_URL" \
  -e IMPORT_TARGET_URL="$TARGET_IMPORT_URL" \
  -e SUPABASE_SECRET_KEY="$SUPABASE_SECRET_KEY" \
  -e LINUXDO_CLIENT_SECRET="$LINUXDO_CLIENT_SECRET" \
  -v /tmp/taibu-cutover:/dump:ro web \
  node scripts/db/import-supabase.mjs --cutover \
    --files-root /data/files --report /tmp/import.json
```

验收（不通过则停止，保持维护页）：

- 报告里每张表行数与源一致，校验和一致，78 项 FK 反连接均为 0。
- `identity.users` = 708；credential 数 = 有哈希用户数 − 被剔除的确定性口令数；linuxdo 账户 = 去重 sub 数（预期 46）。
- 被剔除确定性口令的用户清单已保存，公告中提示用 Linux.do 或验证码登录后重设密码。

### T+11 头像与附件

- 报告 `files.failed` 必须为空；抽查 `FILE_STORAGE_ROOT/avatars/` 与源对象 sha256 一致。
- 旧 `agent-attachments` 对象如存在，同样拷入 `FILE_STORAGE_ROOT/agent-attachments/`。

### T+12 启动应用并冒烟

```sh
docker compose ... up -d web worker
curl -fsS https://$APP_DOMAIN/api/health/ready
```

以管理员 IP 绕过维护页，逐项打勾：

- [ ] 管理员密码登录；错误密码第 6 次返回 429。
- [ ] 测试账号密码登录（bcrypt `$2a$`）。
- [ ] 验证码登录；OTP 邮件到达。
- [ ] 找回密码后旧会话失效。
- [ ] Linux.do 登录、绑定、`membership-claim` 各状态正确。
- [ ] 打开一个已知用户的历史对话：消息、附件、Agent 卡片完整。
- [ ] 上传头像后刷新仍可见；`avatar_url` 为 `/api/files/avatars/...`。
- [ ] 发起一次占术解读，SSE 逐条输出。
- [ ] 功能开关与线上一致（chat 等仍关闭）。
- [ ] 管理员查看待办/提醒；BullMQ `reminders` 调度器已执行过一次。
- [ ] 数据库 `max(updated_at)` 随操作增长，Worker 心跳正常。

### T+25 对外开放

```sh
rm /opt/taibu/maintenance/on
```

之后 60 分钟盯：`docker stats`、`docker compose logs -f web worker`、Caddy 5xx、`pg_stat_activity` 长事务、Worker 认领延迟。

## 4. 回滚（仅限 T+60 内且为 P0 故障）

1. 打开维护页：`touch /opt/taibu/maintenance/on`。
2. Vercel 重新挂回自定义域名；DNS / 源站切回。
3. `gh workflow enable reminders-cron.yml 2>/dev/null || true`。
4. 确认旧应用可登录、提醒恢复。

代价：新栈在对外开放后产生的写入会丢失。超过 T+60 不再回滚，改为在新栈修复。

## 5. 每周备份恢复演练

在 hw 上每周执行一次（建议 systemd timer / cron）。`restore.env` 只需 `RESTORE_ADMIN_URL`（带 CREATEDB 的超级用户/等价角色）。`verify-restore` 会建临时库、恢复、校验迁移历史/用户一致性/FK 孤儿，然后删除临时库：

```sh
compose() { docker compose --project-directory /opt/taibu/source --env-file /opt/taibu/env/compose.env \
  -f /opt/taibu/source/deploy/compose.base.yml -f /opt/taibu/source/deploy/compose.prod.yml "$@"; }
LATEST=$(compose exec -T backup sh -c 'ls -t /backups/taibu-*.dump | head -1' | tr -d '\r')
compose run --rm -T restore-check scripts/db/verify-restore.mjs --backup "$LATEST"
```

报告写入容器内 `tmp/`（随容器删除）；需要留档时把 `--report /backups/verify-$(date +%F).json` 指到可写挂载。任一项检查失败即告警，并按“回滚/恢复”流程处理。

## 6. 切换后清理

- Supabase 项目暂停、Vercel 项目保留 30 天；期满前再做一次最终 `pg_dump` 存入异地备份，然后删除两者。
- 删除 `.github/workflows/reminders-cron.yml` 与 GitHub 的 `CRON_SECRET`。
- 轮换密钥：AI key、`LINUXDO_CLIENT_SECRET`、SMTP 凭据；所有 `SUPABASE_*` 作废。
- 一周后用 `pg_stat_statements` 与 P0 基线对比，结论写入 P10 文档。
- 执行 P10：删除 `supabase/`、旧 compose、service-role 残留，更新 ADR/README/记忆条目。

## 6. 常用排障

| 现象 | 检查 |
|---|---|
| `/api/health/ready` 503 | web 日志中的 DB/Redis 错误；`pg_isready`；Redis `PING` |
| OTP 收不到 | `EMAIL_TRANSPORT`、SMTP 凭据、SPF/DKIM；BullMQ `taibu-email` 失败计数 |
| 登录 429 | Redis `taibu:login-fail:v1:*`；确认不是共享出口 IP 触发 Better Auth 限流 |
| SSE 不刷新 | Caddy `flush_interval -1`；`X-Accel-Buffering: no`；LISTEN 连接是否重连 |
| 导入校验失败 | 查看 `tmp/import-*.json` 的 `tables[].checksum` 与 `orphans`；不要 `--reset-target` 重跑生产 |
| 备份恢复失败 | `verify-restore` 报告；先确认 `pg_restore` 版本与备份一致（17） |
