/**
 * 我的命盘内容
 *
 * 'use client' 标记说明：
 * - 使用 hooks 管理命盘列表、默认值和删除确认
 * - 供统一设置中心复用
 */
'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Calendar, MapPin, Plus } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button, buttonVariants } from '@/components/ui/Button';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';
import { useToast } from '@/components/ui/Toast';
import { SettingsLoginRequired } from '@/components/settings/SettingsLoginRequired';
import { useChartMutation, useUserCharts } from '@/lib/hooks/useUserCharts';
import { getNavItemById } from '@/lib/navigation/registry';
import { deleteUserChart, setDefaultUserChart, type UserChartRecord } from '@/lib/user/charts-client';

type ChartType = 'bazi' | 'ziwei';

interface ChartItem {
  id: string;
  type: ChartType;
  name: string;
  gender: 'male' | 'female' | 'unknown';
  birth_date: string;
  birth_time: string | null;
  city: string | null;
  created_at: string;
  is_default: boolean;
}

function formatCharts(rows: UserChartRecord[], type: ChartType, defaultId: string | null): ChartItem[] {
  return rows.map((chart): ChartItem => ({
    ...chart,
    type,
    gender: chart.gender ?? 'unknown',
    city: chart.birth_place,
    is_default: chart.id === defaultId,
  })).sort((a, b) => Number(b.is_default) - Number(a.is_default) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function getGenderLabel(gender: ChartItem['gender']) {
  if (gender === 'female') return '女';
  if (gender === 'male') return '男';
  return null;
}

function isModifiedEvent(event: MouseEvent<HTMLElement>) {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}

function ChartCard({
  chart,
  onDelete,
  onSetDefault,
  onNavigate,
  pending,
}: {
  chart: ChartItem;
  onDelete: (id: string, type: ChartType) => void;
  onSetDefault: (id: string, type: ChartType) => void;
  pending: boolean;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const href = chart.type === 'bazi' ? `/bazi/result?chart=${chart.id}` : `/ziwei/result?chart=${chart.id}`;
  const genderLabel = getGenderLabel(chart.gender);
  // birth_date 是不带时区的日历日期，按本地零点解析，避免西半球显示成前一天。
  const birthDate = new Date(`${chart.birth_date}T00:00:00`).toLocaleDateString('zh-CN');

  return (
    <li className="chart-card">
      <Link
        href={href}
        onClick={(event) => onNavigate?.(event, href)}
        className="chart-card-main"
      >
        <span className="chart-card-title">
          {chart.name}
          {genderLabel ? <span className="chart-card-gender">{genderLabel}</span> : null}
          {chart.is_default ? <span className="chart-card-default">默认</span> : null}
        </span>
        <span className="chart-card-meta">
          <span><Calendar aria-hidden="true" />{birthDate}{chart.birth_time ? ` ${chart.birth_time}` : ''}</span>
          {chart.city ? <span><MapPin aria-hidden="true" />{chart.city}</span> : null}
        </span>
      </Link>
      <div className="chart-card-actions">
        {!chart.is_default ? (
          <Button unstyled
            type="button"
            disabled={pending}
            onClick={() => onSetDefault(chart.id, chart.type)}
            className="chart-card-action"
            aria-label={`将 ${chart.name} 设为默认`}
          >设为默认</Button>
        ) : null}
        <Button unstyled
          type="button"
          disabled={pending}
          onClick={() => onDelete(chart.id, chart.type)}
          className="chart-card-action is-danger"
          aria-label={`删除命盘 ${chart.name}`}
        >删除</Button>
      </div>
    </li>
  );
}

function ChartSection({
  title,
  list,
  type,
  onDelete,
  onSetDefault,
  onNavigate,
  pending,
}: {
  title: string;
  list: ChartItem[];
  type: ChartType;
  onDelete: (id: string, type: ChartType) => void;
  onSetDefault: (id: string, type: ChartType) => void;
  pending: boolean;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const headingId = `settings-charts-${type}`;
  const createHref = getNavItemById(type)?.href ?? `/${type}`;

  return (
    <section aria-labelledby={headingId} data-settings-highlight={`charts-${type}`} className="charts-group">
      <div className="charts-group-head">
        <h3 id={headingId}>{title}<span className="settings-section-count">{list.length}</span></h3>
        <Link href={createHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          新建{title}
        </Link>
      </div>
      {list.length ? (
        <ul className="charts-grid" aria-labelledby={headingId}>
          {list.map(chart => (
            <ChartCard
              key={`${type}-${chart.id}`}
              chart={chart}
              onDelete={onDelete}
              onSetDefault={onSetDefault}
              onNavigate={onNavigate}
              pending={pending}
            />
          ))}
        </ul>
      ) : (
        <div className="charts-empty">
          <p>还没有保存{title}</p>
          <Link href={createHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>去排{title}</Link>
        </div>
      )}
    </section>
  );
}

export default function ChartsPanel() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSessionSafe();
  const { showToast } = useToast();
  const userId = user?.id;
  const chartsQuery = useUserCharts(userId, { enabled: !sessionLoading });
  const { pending, run } = useChartMutation(userId);
  const baziCharts = useMemo(() => formatCharts(chartsQuery.data?.baziCharts ?? [], 'bazi', chartsQuery.data?.defaultChartIds.bazi ?? null), [chartsQuery.data]);
  const ziweiCharts = useMemo(() => formatCharts(chartsQuery.data?.ziweiCharts ?? [], 'ziwei', chartsQuery.data?.defaultChartIds.ziwei ?? null), [chartsQuery.data]);
  const [pendingDelete, setPendingDelete] = useState<{ userId: string; id: string; type: ChartType } | null>(null);
  const currentDelete = pendingDelete?.userId === userId ? pendingDelete : null;

  useEffect(() => {
    if (chartsQuery.error) showToast('error', '加载命盘失败');
  }, [chartsQuery.error, showToast]);

  const handleNavigate = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || isModifiedEvent(event)) return;

    event.preventDefault();

    router.push(href);
  }, [router]);

  const handleDelete = (id: string, type: ChartType) => run(
    scope => deleteUserChart(type, id, scope),
    () => {
      setPendingDelete(null);
      showToast('success', '命盘已删除');
    },
    () => showToast('error', '删除命盘失败'),
  );

  const handleSetDefault = (id: string, type: ChartType) => {
    void run(
      scope => setDefaultUserChart(type, id, scope),
      () => showToast('success', '默认命盘已更新'),
      () => showToast('error', '设置默认命盘失败'),
    );
  };

  if (chartsQuery.isLoading || sessionLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-border bg-surface">
        <SoundWaveLoader variant="inline" />
      </div>
    );
  }

  if (!user) {
    return <SettingsLoginRequired title="请先登录后管理命盘" />;
  }

  const requestDelete = (id: string, type: ChartType) => {
    if (!pending) setPendingDelete({ userId: user.id, id, type });
  };

  return (
    <div>
      {chartsQuery.error ? (
        <div role="alert" className="settings-alert">
          <span className="min-w-0 flex-1">加载命盘失败，已显示的命盘未改变。</span>
          <Button variant="ghost" size="xs" onClick={() => { void chartsQuery.refetch(); }}>重试</Button>
        </div>
      ) : null}

      <ChartSection
        title="八字命盘"
        list={baziCharts}
        type="bazi"
        onDelete={requestDelete}
        onSetDefault={handleSetDefault}
        onNavigate={handleNavigate}
        pending={pending}
      />

      <ChartSection
        title="紫微命盘"
        list={ziweiCharts}
        type="ziwei"
        onDelete={requestDelete}
        onSetDefault={handleSetDefault}
        onNavigate={handleNavigate}
        pending={pending}
      />

      <ConfirmDialog
        isOpen={!!currentDelete}
        loading={pending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => currentDelete ? handleDelete(currentDelete.id, currentDelete.type) : undefined}
        title="确认删除"
        description="确定要删除这个命盘吗？此操作无法撤销。"
        confirmText="确认删除"
        variant="danger"
      />
    </div>
  );
}
