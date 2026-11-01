# 升级说明

## 数据库迁移

从 0.2.3 或更早版本升级到 0.2.4 时，系统会自动执行数据库迁移：

### 第一次启动

首次启动新版本时，`db:init` 会：
1. 执行编号迁移（`database/migrations/*.sql`）
2. 自动补齐缺失的表、列和约束
3. 记录迁移到账本中（`taibu_meta.schema_migrations`）

此过程由数据库咨询锁保护，确保并发部署安全。

### 旧数据清理

以下旧数据在升级时会被删除，无法恢复：
- **旧积分系统**：`credit_transactions` 表（已改为美元计费）
- **会员系统**：`users.membership`、`users.membership_expires_at` 列
- **每日签到**：`daily_checkins`、`daily_briefing_jobs` 表及相关配置
- **激活码**：`activation_keys` 表
- **旧网关配置**：`ai_gateways.api_key_env_var`、`ai_gateways.transport` 列

后续版本每个新迁移都会自动应用，无需手动操作。

## 网关密钥重新配置

从旧版本升级后，网关密钥原来存放在环境变量中的配置需要重新在后台填入：

1. 登录管理后台
2. 进入**设置 → AI 模型管理 → 网关管理**
3. 编辑各个网关，重新输入 API 密钥
4. 密钥会加密存储在数据库中

## 自建部署的更新配置

如果自建部署（非 Docker 镜像），需要启用一键更新功能：

```bash
# 在主机上执行（需要 root 权限或 sudo）
sudo bash ./deploy/install-updater.sh
```

此脚本会：
1. 创建 systemd service `taibu-updater`
2. 每 5 秒检查信号目录 `/run/taibu`，发现 `update-request` 后调用 `deploy/update.sh`
3. 由 `deploy/deploy.sh <tag>` 完成备份、拉取镜像、`db-setup`/`db-init` 与滚动重启，并把结果写回 `deployment_logs`

**前置条件**：
- Docker Compose 已安装，项目源码位于 `/opt/taibu/source`（可用 `ROOT=` 覆盖）
- `compose.env` 位于 `/opt/taibu/env/compose.env`（可用 `ENV_FILE=` 覆盖）
- 在 `compose.env` 中写入 `TAIBU_RUN_DIR=/run/taibu`，让 web 容器与主机共享信号目录（`deploy/compose.base.yml` 已按此变量挂载）

不需要 inotify-tools。

## 版本更新

### 自动检查

系统每 6 小时检查一次 GitHub Releases，查询最新版本。检查失败或超时时不会影响应用运行。

### 手动更新（需要管理员权限）

1. 登录管理后台
2. 点击侧栏「太卜」右侧的**版本号**
3. 在弹窗中查看发布说明和升级须知
4. 确认无进行中的 Agent 任务后，点击**立即更新**

系统会：
1. 先检查是否有进行中的 Agent 任务；有则拒绝更新
2. 在共享目录写入更新请求，由主机 `taibu-updater` 服务接手
3. 执行 `deploy/deploy.sh <tag>`：备份、拉取最新镜像、运行迁移、滚动重启
4. 结果（成功/失败与执行日志）写回部署日志

### 忽略版本

如果不想立即更新，可在版本弹窗中点击**忽略此版本**，隐藏更新提示。

## 部署日志

管理员可在**设置 → 日志 → 部署日志**查看：
- 每次更新的触发者、时间、版本变化
- 更新的执行状态（待处理 / 进行中 / 成功 / 失败）
- 完整的更新日志输出

## 故障排查

### 数据库迁移失败

如果 `db:init` 报错：

1. 检查错误信息中列出的具体问题（表名、列名等）
2. 确保旧库结构与迁移文件中的守卫条件匹配
3. 查看 `database/migrations/` 下相应迁移文件的注释

如需帮助，请到 GitHub 提交 Issue。

### 更新失败

检查 `deployment_logs` 中失败日志的详细输出，通常原因有：

- 磁盘空间不足：清理旧镜像 `docker image prune`
- 网络问题：检查 Docker Hub 访问
- 端口占用：检查 80/443 是否被占用

重试更新：在管理后台再次点击版本号并选择**立即更新**。

## 版本支持

- **当前版本**：显示本地部署版本
- **最新版本**：从 GitHub Releases 查询
- **更新检查间隔**：6 小时
- **更新检查超时**：3 秒

如果 GitHub Releases 暂时不可达，系统会使用缓存的版本信息。
