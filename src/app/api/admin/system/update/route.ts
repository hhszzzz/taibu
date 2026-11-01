/**
 * Trigger system update API
 *
 * POST: refuse while Agent tasks run, record the request in deployment_logs and
 * signal the host updater service through a file in the shared run directory.
 */
import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { jsonError, jsonOk, requireAdminContext } from '@/lib/api-utils';
import { systemDb } from '@/lib/db/context.server';
import { listAgentRunsForAdmin } from '@/lib/agent/admin-tasks.server';
import { getVersionInfo } from '@/lib/version.server';

/** Host updater watches this file; it sees ours through the /run/taibu bind mount. */
const UPDATE_SIGNAL_FILE = process.env.TAIBU_UPDATE_SIGNAL ?? '/run/taibu/update-request';
/** Written by taibu-updater on start; without it nothing would act on the request. */
const UPDATER_READY_FILE = path.join(path.dirname(UPDATE_SIGNAL_FILE), 'updater-ready');

export async function POST(request: NextRequest) {
  const auth = await requireAdminContext(request);
  if ('error' in auth) {
    return jsonError(auth.error.message, auth.error.status);
  }

  try {
    const versionInfo = await getVersionInfo();
    if (!versionInfo.needsUpdate || !versionInfo.latest) {
      return jsonError('当前已是最新版本', 400);
    }

    const db = systemDb();
    const running = await listAgentRunsForAdmin(db, { scope: 'active' });
    if (running.length > 0) {
      return jsonError(`还有 ${running.length} 个 Agent 任务正在运行，请等待完成后再更新`, 409, { runs: running.length });
    }

    try {
      await fs.access(UPDATER_READY_FILE);
    } catch {
      return jsonError('主机未安装更新服务，请先运行 deploy/install-updater.sh', 503);
    }

    // The signal comes first: without it nothing would ever run, and the log
    // row is written once the host service has been notified.
    const logId = crypto.randomUUID();
    try {
      await fs.writeFile(UPDATE_SIGNAL_FILE, JSON.stringify({
        version_from: versionInfo.current,
        version_to: versionInfo.latest,
        // Image tags keep the release's own tag (v0.2.4), which deploy.sh expects.
        release_tag: versionInfo.releaseName ?? versionInfo.latest,
        log_id: logId,
        triggered_at: new Date().toISOString(),
      }), { encoding: 'utf-8', flag: 'wx', mode: 0o640 });
    } catch (signalError) {
      if ((signalError as NodeJS.ErrnoException).code === 'EEXIST') {
        return jsonError('已有更新请求正在处理中', 409);
      }
      console.warn('[admin][system][update] failed to write signal file:', signalError);
      return jsonError('无法通知主机更新服务，请确认部署已安装 updater', 503);
    }

    try {
      await db.tx((trx) => trx
        .insertInto('deployment_logs')
        .values({
          id: logId,
          version_from: versionInfo.current,
          version_to: versionInfo.latest!,
          triggered_by: auth.user.id,
          status: 'pending',
        })
        .execute());
    } catch (logError) {
      // The update is already dispatched; a missing log row must not fail it.
      console.error('[admin][system][update] failed to record deployment log:', logError);
    }

    return jsonOk({ success: true, logId, message: '更新请求已发送，请稍候...' });
  } catch (error) {
    console.error('[admin][system][update][POST] failed:', error);
    return jsonError('触发更新失败', 500);
  }
}
