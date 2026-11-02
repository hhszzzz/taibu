# 升级说明

本文说明怎样把已有部署升级到 1.0.0，以及之后的版本怎样更新。每个版本改了什么见 [CHANGELOG](../CHANGELOG.md)，部署与配置细节见 [自托管手册](manual/Self-Hosting.md)。

## 适用范围

| 现有部署 | 升级方式 |
| --- | --- |
| 1.0.0 及之后的自托管栈 | 后台一键更新，或在主机执行 `deploy/deploy.sh <tag>` |
| 1.0.0 之前的自托管栈（Docker Compose + 自有 PostgreSQL） | 备份后部署最新版本，由 `db-init` 自动执行迁移 |
| Supabase + Vercel 托管版 | 不能原地升级，需新建自托管栈并导入数据 |

## 从 1.0.0 之前的自托管栈升级

1. **备份**。`deploy/deploy.sh` 在升级前会自动 `pg_dump` 一份到 `/opt/taibu/backups/`；本地栈用 `pnpm selfhost backup --project <项目> --output <文件>`。数据重要时先演练：把备份恢复到同一集群的临时库，用新版本的 `scripts/db/bootstrap.mjs --no-passwords` 与 `scripts/db/init.mjs` 对它各执行一次，确认迁移与补齐都能完成，再删除临时库。角色是集群级的，演练时不要设置口令，以免改动正在运行的栈的口令。
2. **更新配置**。`compose.env` 写入 `TAIBU_IMAGE=ghcr.io/hhszzzz/taibu`；宿主已有 Caddy 时再写 `EDGE_MODE=host` 与 `WEB_PORT`。私有配置按容器拆分为 `app.env`、`db.env`、`db-setup.env`、`schema.env`、`redis.env`、`backup.env`、`restore.env`，旧的 `migrate.env` 已改名为 `schema.env`。
3. **部署**。在主机源码目录执行 `deploy/deploy.sh <tag>`，例如 `deploy/deploy.sh v1.0.1`。脚本依次执行 `files-init`、`db-setup`、`db-init`，成功后更新 Web 与 worker 并检查 `/api/health/ready`，失败时退回 `compose.env` 记录的上一个镜像。
4. **重新配置**。按下文「升级后需要重新配置」逐项完成。

### 数据库迁移

`db-init` 先执行 `database/migrations/` 中尚未执行的编号迁移，再把 `database/` 里新增的表、列与约束补齐到已有库。迁移账本 `taibu_meta.schema_migrations` 记录每个文件的校验和与耗时，整个过程由数据库咨询锁保护，可以安全重试。全新安装直接按当前 SQL 建库，并把全部迁移记为基线。

| 迁移 | 作用 |
| --- | --- |
| `0001_converge_legacy_schema` | 删除积分、会员、签到、激活码、旧早报和旧网关/模型字段；改名 Agent 计费状态；把 `vision` 用途并入对话模型 |
| `0002_subscription_windows` | 把旧的单一订阅额度迁入分周期额度表（5 小时、天、周、月、整期） |
| `0003_community_report_dedup` | 每个用户对同一目标只保留一条待处理举报 |

迁移执行完后，如果库里仍有类型不同、改过名或未声明的表与列，`db-init` 不会自行处理：它停下并列出全部差异，这类结构变更要写成新的编号迁移。

### 删除的数据

以下旧数据在 `0001` 中删除，无法恢复：

- 积分流水 `credit_transactions`，以及 `users.ai_chat_count`；
- 会员等级 `users.membership`、`users.membership_expires_at`；
- 每日签到 `daily_checkins`、激活码 `activation_keys`；
- 每日早报 `daily_briefing_jobs`、`user_settings.daily_briefing_settings` 与早报提醒订阅；需要的用户可在「定时任务」里用「每日早报」模板重新创建；
- 旧网关与模型字段，如 `ai_gateways.api_key_env_var`、`ai_gateways.transport` 等。

### 升级后需要重新配置

- **网关密钥**：密钥改为用 `AGENT_CREDENTIAL_ENCRYPTION_KEY` 派生的密钥加密存入数据库，不再读取环境变量。管理员在「设置 → AI 服务 → 网关管理」逐个重新填写。
- **模型单价**：平台模型按美元单价计费，单价留空的模型不对用户提供。在「模型管理」填写单价，或用「从 models.dev 补全」补齐。
- **联网搜索**：不再读取 `TAVILY_API_KEY`，`AGENT_MCP_SERVERS` 也已移除。在「设置 → Agent 扩展 → MCP 服务」接入 Exa、Tavily 等服务并标为搜索或读网页工具后，联网搜索才可用。
- **余额与套餐**：新用户余额为 0。在「设置 → 计费」建套餐、生成兑换码，或直接给用户加余额；需要在线支付时配置易支付。
- **邮件**：生产环境必须配置真实的 SMTP 中转（`EMAIL_PROVIDER` 与 `SMTP_*`），`log` 在生产环境拒绝启动。

## 从 Supabase 托管版迁移

1.0.0 只运行在自有 PostgreSQL 上，不再包含 Supabase 适配。托管版的数据要经一次性导入：先用 `pg_dump -Fc` 导出 `public` 与 `supabase_migrations`，再连同 `auth.users`、`auth.identities` 的 CSV 交给导入工具，导入到按 1.0.0 之前结构建好的库，然后照上一节升级到 1.0.0。

导入工具（`scripts/db/transit-build.mjs`、`scripts/db/import-supabase.mjs` 等）已从仓库移除，需要时从提交 `8e342425` 取出。它们只认识迁移前的结构；导入前停止 worker 并清空 `agent_workers`，有 Linux.do 账号时还必须提供旧部署的 HMAC 种子（`SUPABASE_SECRET_KEY` 或 `LINUXDO_CLIENT_SECRET`），否则会拒绝导入。

## 之后的版本更新

### 后台一键更新

在主机源码目录执行一次，安装 `taibu-updater` 服务：

```bash
sudo ROOT=/opt/taibu/source deploy/install-updater.sh
```

并在 `compose.env` 写入 `TAIBU_RUN_DIR=/run/taibu`，让 Web 容器与主机共用信号目录。之后：

1. 系统每 6 小时向 GitHub Releases 查询一次最新版本（超时 3 秒，失败时沿用缓存，不影响站点）；
2. 管理员点侧栏「太卜」右侧的版本号，在弹窗中查看发布说明与升级须知；
3. 没有进行中的 Agent 任务时点「立即更新」。主机服务接到请求后执行 `deploy/deploy.sh <tag>`，结果写入「设置 → 日志 → 部署日志」。

不想立即更新时点「忽略此版本」，提示会隐藏到下一个版本发布。

### 手动更新

```bash
cd /opt/taibu/source
git fetch --tags && git checkout <tag>
deploy/deploy.sh <tag>
```

`EDGE_MODE` 未在命令行指定时取 `compose.env` 里的值。

## 回滚

`deploy/deploy.sh` 在启动失败或健康检查超时时，会把 Web 与 worker 退回 `compose.env` 记录的上一个镜像。数据库结构已由新版本的 `db-init` 收敛，切回旧镜像不会撤销迁移；要回到迁移之前，停止 Web 与 worker 后恢复升级前的备份（`/opt/taibu/backups/pre-<tag>-*`），再用对应的旧镜像部署。

## 故障排查

- **`db-init` 失败**：错误信息逐条列出差异（表、列、类型或约束）。确认库里没有手工建的同名对象；需要删除或改型的结构写成新的编号迁移，不要修改已执行的迁移。
- **一键更新提示「主机未安装更新服务」**：`taibu-updater` 没有运行，或 Web 容器没有挂载同一个 `TAIBU_RUN_DIR`。用 `systemctl status taibu-updater` 与 `journalctl -u taibu-updater -f` 检查。
- **更新失败**：在「部署日志」查看输出。常见原因是磁盘不足（`docker image prune`）、镜像仓库不可达，或 80/443 端口冲突——宿主已有反向代理时 `compose.env` 必须是 `EDGE_MODE=host`。
