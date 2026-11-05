/**
 * 部署日志：管理员触发的一键更新记录，按时间倒序列出，展开可看完整执行输出。
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { requestBrowserData } from '@/lib/browser-api';
import { formatBillingTime } from '@/lib/billing/format';

type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed';

interface DeploymentLog {
  id: string;
  version_from: string | null;
  version_to: string;
  nickname: string | null;
  status: DeploymentStatus;
  started_at: string;
  completed_at: string | null;
  log_output: string | null;
  created_at: string;
}

interface DeploymentLogPage {
  items: DeploymentLog[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const STATUS: Record<DeploymentStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'danger' }> = {
  pending: { label: '等待中', tone: 'neutral' },
  running: { label: '执行中', tone: 'accent' },
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
};

const CARD = 'rounded-2xl border border-border bg-surface';
const TH = 'px-3 py-2.5 text-left text-xs font-medium text-foreground-tertiary';
const TD = 'px-3 py-2.5 text-[13px] text-foreground-secondary';

function durationOf(log: DeploymentLog): string | null {
  if (!log.completed_at) return null;
  const seconds = Math.round((Date.parse(log.completed_at) - Date.parse(log.started_at)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

export function DeploymentLogsPanel() {
  const [page, setPage] = useState<DeploymentLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeploymentLog | null>(null);
  const request = useRef(0);

  const load = useCallback(async (target: number) => {
    const current = ++request.current;
    setLoading(true);
    try {
      const data = await requestBrowserData<DeploymentLogPage>(
        `/api/admin/system/deployment-logs?page=${target}`, { method: 'GET' }, { fallbackMessage: '读取部署日志失败' });
      if (current !== request.current) return;
      setPage(data);
      setError(null);
    } catch (failure) {
      if (current === request.current) setError(failure instanceof Error ? failure.message : '读取部署日志失败');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(() => load(1)); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-foreground-secondary">管理员在侧栏版本号中触发的更新，及其在主机上的执行结果。</p>
        <Button variant="secondary" size="sm" onClick={() => { void load(page?.page ?? 1); }} loading={loading}>
          <RefreshCw aria-hidden="true" className="size-4" />刷新
        </Button>
      </div>

      {error ? <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</p> : null}

      <div className={`${CARD} overflow-hidden`}>
        {loading && !page ? (
          <div className="flex justify-center py-10"><SoundWaveLoader /></div>
        ) : !page?.items.length ? (
          <p className="py-10 text-center text-sm text-foreground-secondary">还没有部署记录。</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>触发时间</th>
                <th className={TH}>版本</th>
                <th className={TH}>触发者</th>
                <th className={TH}>状态</th>
                <th className={TH}>耗时</th>
                <th className={TH}><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((log) => (
                <tr key={log.id} className="border-b border-border last:border-b-0">
                  <td className={TD}>{formatBillingTime(log.created_at)}</td>
                  <td className={TD}><span className="font-mono text-foreground">{log.version_from ?? '?'} → {log.version_to}</span></td>
                  <td className={TD}>{log.nickname ?? '已删除用户'}</td>
                  <td className={TD}><Badge variant={STATUS[log.status]?.tone ?? 'neutral'}>{STATUS[log.status]?.label ?? log.status}</Badge></td>
                  <td className={TD}>{durationOf(log) ?? '—'}</td>
                  <td className={TD}>
                    <Button variant="ghost" size="xs" onClick={() => setDetail(log)}>详情</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {page && (page.page > 1 || page.hasMore) ? (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={page.page <= 1 || loading} onClick={() => { void load(page.page - 1); }}>上一页</Button>
          <Button variant="secondary" size="sm" disabled={!page.hasMore || loading} onClick={() => { void load(page.page + 1); }}>下一页</Button>
        </div>
      ) : null}

      {detail ? (
        <Dialog
          open
          onClose={() => setDetail(null)}
          title={`部署到 ${detail.version_to}`}
          description={`${formatBillingTime(detail.created_at)} · ${STATUS[detail.status]?.label ?? detail.status}`}
        >
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background-secondary p-3 font-mono text-xs text-foreground-secondary">
            {detail.log_output?.trim() || '没有执行输出。'}
          </pre>
        </Dialog>
      ) : null}
    </div>
  );
}
