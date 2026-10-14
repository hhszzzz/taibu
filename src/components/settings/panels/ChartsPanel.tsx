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
import { Calendar, MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { useSessionSafe } from '@/components/providers/ClientProviders';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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

const CHART_ACTION_BUTTON = 'flex h-9 w-9 items-center justify-center rounded-lg text-foreground-secondary transition-colors duration-150 hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-50';

function ChartRow({
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
    <li className="flex items-center gap-3 py-3.5 pl-5 pr-3 transition-colors duration-150 hover:bg-background-secondary/60 [&+li]:border-t [&+li]:border-border">
      <Link
        href={href}
        onClick={(event) => onNavigate?.(event, href)}
        className="flex min-w-0 flex-1 flex-col gap-1.5 text-foreground"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-[15px] font-medium">{chart.name}</h4>
          {genderLabel ? (
            <span className="rounded-md bg-background-secondary px-1.5 py-px text-xs text-foreground-secondary">{genderLabel}</span>
          ) : null}
          {chart.is_default ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">
              <Star aria-hidden="true" className="h-3 w-3 fill-current" />
              默认
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-foreground-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Calendar aria-hidden="true" className="h-3.5 w-3.5" />
            {birthDate}{chart.birth_time ? ` ${chart.birth_time}` : ''}
          </span>
          {chart.city ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
              {chart.city}
            </span>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-shrink-0 items-center gap-0.5">
        {!chart.is_default ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSetDefault(chart.id, chart.type)}
            className={`${CHART_ACTION_BUTTON} hover:text-accent`}
            aria-label={`将 ${chart.name} 设为默认`}
            title="设为默认"
          >
            <Star aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => onDelete(chart.id, chart.type)}
          className={`${CHART_ACTION_BUTTON} hover:text-danger`}
          aria-label={`删除命盘 ${chart.name}`}
          title="删除命盘"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5 text-[13px] text-foreground-tertiary">
          <h3 id={headingId} className="font-medium">{title}</h3>
          <span><span className="sr-only">共 </span>{list.length}<span className="sr-only"> 个</span></span>
        </div>
        <Link href={createHref} className="inline-flex items-center gap-1 text-[13px] text-accent transition-colors duration-150 hover:text-accent-hover">
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          新建{title}
        </Link>
      </div>

      {list.length > 0 ? (
        <ul className="overflow-hidden rounded-[14px] border border-border bg-surface">
          {list.map((chart) => (
            <ChartRow
              key={`${chart.type}-${chart.id}`}
              chart={chart}
              onDelete={onDelete}
              onSetDefault={onSetDefault}
              onNavigate={onNavigate}
              pending={pending}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-border-hover px-6 py-9 text-center">
          <p className="text-sm text-foreground-secondary">还没有保存{title}</p>
          <Link href={createHref} className="settings-button">去排{title}</Link>
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
      <div className="flex min-h-[240px] items-center justify-center rounded-[14px] border border-border bg-surface">
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
    <div className="flex flex-col gap-9">
      {chartsQuery.error ? (
        <div role="alert" className="settings-alert">
          <span className="min-w-0 flex-1">加载命盘失败，已显示的命盘未改变。</span>
          <button type="button" onClick={() => { void chartsQuery.refetch(); }}>重试</button>
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
