/**
 * Update dialog: release notes, upgrade notes and a pre-flight check for
 * running Agent tasks before asking the host updater to pull the new release.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { requestBrowserData } from '@/lib/browser-api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import type { VersionInfo } from '@/lib/version';

interface UpdateDialogProps {
  versionInfo: VersionInfo;
  onClose: () => void;
  onIgnore: () => void;
}

type Tab = 'info' | 'upgrade' | 'tasks';

async function fetchActiveTaskCount(): Promise<number | null> {
  try {
    const data = await requestBrowserData<{ runs?: unknown[] }>(
      '/api/admin/agent-runs?scope=active',
      undefined,
      { fallbackMessage: '读取运行中的任务失败' },
    );
    return Array.isArray(data.runs) ? data.runs.length : 0;
  } catch {
    return null;
  }
}

async function triggerUpdate(): Promise<void> {
  const response = await fetch('/api/admin/system/update', { method: 'POST' });
  if (response.ok) return;
  const body = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(body?.error ?? '更新请求失败');
}

export function UpdateDialog({ versionInfo, onClose, onIgnore }: UpdateDialogProps) {
  const [tab, setTab] = useState<Tab>('info');
  const [activeTasks, setActiveTasks] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveTaskCount().then((count) => {
      if (!cancelled) setActiveTasks(count);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setError(null);
    try {
      await triggerUpdate();
      setSubmitted(true);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '更新请求失败');
    } finally {
      setUpdating(false);
    }
  }, []);

  const canUpdate = activeTasks === 0 && !updating && !submitted;

  return (
    <Dialog
      open
      onClose={onClose}
      busy={updating}
      title={versionInfo.needsUpdate ? `新版本可用：${versionInfo.latest ?? ''}` : '当前已是最新版本'}
      description={versionInfo.publishedAt
        ? `发布于 ${new Date(versionInfo.publishedAt).toLocaleString('zh-CN')}`
        : undefined}
      footer={
        <>
          {versionInfo.needsUpdate ? <Button variant="ghost" onClick={onIgnore}>忽略此版本</Button> : null}
          {versionInfo.releaseUrl ? (
            <Button variant="ghost" onClick={() => window.open(versionInfo.releaseUrl ?? '', '_blank', 'noopener')}>
              查看完整发布说明
            </Button>
          ) : null}
          {versionInfo.needsUpdate ? (
            <Button onClick={handleUpdate} disabled={!canUpdate} loading={updating} loadingText="提交中...">
              {submitted ? '已提交更新' : '立即更新'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="mb-4 -mx-6 flex gap-3 border-b border-border px-6">
        {(['info', 'upgrade', 'tasks'] as const).map((name) => (
          <Button
            key={name}
            unstyled
            aria-current={tab === name ? 'true' : undefined}
            onClick={() => setTab(name)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm transition-colors ${
              tab === name
                ? 'border-accent text-foreground'
                : 'border-transparent text-foreground-secondary hover:text-foreground'
            }`}
          >
            {name === 'info' ? '版本信息' : name === 'upgrade' ? '升级须知' : '运行中的任务'}
          </Button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-foreground-secondary">当前版本</dt>
            <dd className="font-mono text-foreground">{versionInfo.current}</dd>
            <dt className="text-foreground-secondary">最新版本</dt>
            <dd className="font-mono text-foreground">{versionInfo.latest}</dd>
          </dl>
          <div className="max-h-56 overflow-y-auto rounded-lg bg-background-secondary p-3">
            {versionInfo.releaseNotes ? (
              <MarkdownContent content={versionInfo.releaseNotes} className="text-sm" />
            ) : (
              <p className="text-sm text-foreground-secondary">该版本没有填写发布说明。</p>
            )}
          </div>
        </div>
      )}

      {tab === 'upgrade' && (
        <div className="max-h-64 space-y-4 overflow-y-auto text-sm">
          <section>
            <h3 className="mb-1 font-medium text-foreground">数据库迁移</h3>
            <p className="text-foreground-secondary">
              升级时自动执行数据库迁移，由咨询锁保护；迁移失败会整体回滚，旧版本继续运行。
            </p>
          </section>
          <section>
            <h3 className="mb-1 font-medium text-foreground">已删除的旧数据</h3>
            <p className="text-foreground-secondary">
              旧积分、会员、每日签到与激活码的数据会在首次升级时删除，无法恢复。
            </p>
          </section>
          <section>
            <h3 className="mb-1 font-medium text-foreground">网关密钥</h3>
            <p className="text-foreground-secondary">
              旧版本把网关密钥放在环境变量里；升级后需在「设置 → AI 模型管理 → 网关管理」重新填写。
            </p>
          </section>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-3 text-sm">
          {activeTasks === null ? (
            <p className="py-4 text-center text-foreground-secondary">加载中...</p>
          ) : activeTasks > 0 ? (
            <p className="rounded-lg bg-warning/10 p-3 text-foreground">
              有 {activeTasks} 个 Agent 任务正在运行，请等待完成后再更新。
            </p>
          ) : (
            <p className="rounded-lg bg-background-secondary p-3 text-foreground">可以安全更新，没有进行中的任务。</p>
          )}
        </div>
      )}

      {submitted && (
        <p className="mt-4 rounded-lg bg-background-secondary p-3 text-sm text-foreground">
          更新请求已提交。几分钟内页面会短暂中断，之后刷新即可；可在「部署日志」查看进度。
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</p>
      )}
    </Dialog>
  );
}
