import { requestBrowserJson, type BrowserRequestInit } from '@/lib/browser-api';
import { mutationEffects } from '@/lib/query/invalidation';
import type { BaziOutput as CoreBaziOutput } from 'taibu-core/bazi';
import { calculateBaziOutputFromStoredFields } from '@/lib/divination/bazi-record';
import { resolveBirthTimeOptions, type BirthTimeResolution } from '@/lib/divination/birth-time';

export type UserChartType = 'bazi' | 'ziwei';

export type UserChartRecord = BirthTimeResolution & {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
  birth_date: string;
  birth_time: string | null;
  birth_place: string | null;
  longitude?: number | null;
  calendar_type?: string | null;
  is_leap_month?: boolean | null;
  created_at: string;
};

type RawUserChartBundle = {
  baziCharts?: Array<Record<string, unknown>>;
  ziweiCharts?: Array<Record<string, unknown>>;
  defaultChartIds?: {
    bazi?: string | null;
    ziwei?: string | null;
  };
};

export type UserChartBundle = {
  baziCharts: UserChartRecord[];
  ziweiCharts: UserChartRecord[];
  defaultChartIds: {
    bazi: string | null;
    ziwei: string | null;
  };
};

export type SelectableChart = {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
  birth_date: string;
  birth_time: string | null;
  type: UserChartType;
};

export type SavedBaziChart = {
  id: string;
  name: string;
  output: CoreBaziOutput;
};

export type ChartRequestScope = {
  expectedUserId?: string;
  signal?: AbortSignal;
};

function chartRequestInit(scope: ChartRequestScope, write = false): BrowserRequestInit {
  return {
    signal: scope.signal,
    headers: scope.expectedUserId
      ? { 'Content-Type': 'application/json', 'X-Expected-User-Id': scope.expectedUserId }
      : undefined,
    mutationEffects: write && scope.expectedUserId ? mutationEffects.userCharts(scope.expectedUserId) : undefined,
  };
}

async function requestChartsJson<T>(
  url = '/api/user/charts',
  init?: BrowserRequestInit,
  fallbackMessage = '请求失败',
): Promise<T> {
  const result = await requestBrowserJson<T>(url, init);
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }

  if (result.data == null) {
    throw new Error(fallbackMessage);
  }

  return result.data;
}

function toChartRecord(row: Record<string, unknown> | null | undefined): UserChartRecord | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  if (
    typeof row.id !== 'string'
    || typeof row.name !== 'string'
    || typeof row.birth_date !== 'string'
    || typeof row.created_at !== 'string'
  ) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    gender: row.gender === 'male' || row.gender === 'female' ? row.gender : null,
    birth_date: row.birth_date,
    birth_time: typeof row.birth_time === 'string' ? row.birth_time : null,
    birth_place: typeof row.birth_place === 'string' ? row.birth_place : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    calendar_type: typeof row.calendar_type === 'string' ? row.calendar_type : null,
    is_leap_month: typeof row.is_leap_month === 'boolean' ? row.is_leap_month : null,
    created_at: row.created_at,
    ...resolveBirthTimeOptions(row),
  };
}

function normalizeUserChartBundle(bundle: RawUserChartBundle | null | undefined): UserChartBundle {
  return {
    baziCharts: Array.isArray(bundle?.baziCharts)
      ? bundle.baziCharts.map((row) => toChartRecord(row)).filter((row): row is UserChartRecord => row !== null)
      : [],
    ziweiCharts: Array.isArray(bundle?.ziweiCharts)
      ? bundle.ziweiCharts.map((row) => toChartRecord(row)).filter((row): row is UserChartRecord => row !== null)
      : [],
    defaultChartIds: {
      bazi: typeof bundle?.defaultChartIds?.bazi === 'string' ? bundle.defaultChartIds.bazi : null,
      ziwei: typeof bundle?.defaultChartIds?.ziwei === 'string' ? bundle.defaultChartIds.ziwei : null,
    },
  };
}

export function toSavedBaziChart(row: UserChartRecord | Record<string, unknown> | null | undefined): SavedBaziChart | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const output = calculateBaziOutputFromStoredFields({
    gender: row.gender as string | null | undefined,
    birth_date: row.birth_date as string | null | undefined,
    birth_time: row.birth_time as string | null | undefined,
    birth_place: row.birth_place as string | null | undefined,
    longitude: row.longitude as number | string | null | undefined,
    calendar_type: row.calendar_type as string | null | undefined,
    is_leap_month: row.is_leap_month as boolean | null | undefined,
    timezone: row.timezone,
    disambiguation: row.disambiguation,
  });

  if (typeof row.id !== 'string' || typeof row.name !== 'string' || !output) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    output,
  };
}

export async function getUserCharts(scope: ChartRequestScope = {}): Promise<UserChartBundle> {
  const data = await requestChartsJson<RawUserChartBundle>('/api/user/charts', { ...chartRequestInit(scope), method: 'GET' }, '获取命盘列表失败');
  return normalizeUserChartBundle(data);
}

export function listSavedBaziCharts(bundle: UserChartBundle | null | undefined): SavedBaziChart[] {
  const rows = bundle?.baziCharts ?? [];
  return rows
    .map((chart) => toSavedBaziChart(chart))
    .filter((chart): chart is SavedBaziChart => chart !== null);
}

export function selectPrimarySavedBaziChart(bundle: UserChartBundle | null | undefined): SavedBaziChart | null {
  const charts = listSavedBaziCharts(bundle);
  if (charts.length === 0) {
    return null;
  }

  const defaultId = bundle?.defaultChartIds?.bazi ?? null;
  return charts.find((chart) => chart.id === defaultId) || charts[0];
}

export async function loadSavedChart(type: UserChartType, id: string, scope: ChartRequestScope = {}) {
  const result = await requestBrowserJson<{ chart?: Record<string, unknown> | null }>(`/api/${type}/charts?id=${encodeURIComponent(id)}`, {
    ...chartRequestInit(scope),
    method: 'GET',
  });

  if (result.error) {
    throw new Error(result.error.message || '加载命盘失败');
  }

  return result.data?.chart ?? null;
}

export async function createSavedChart(type: UserChartType, payload: Record<string, unknown>, scope: ChartRequestScope = {}) {
  const data = await requestChartsJson<{ id?: string | null }>(
    `/api/${type}/charts`,
    {
      ...chartRequestInit(scope, true),
      method: 'POST',
      body: JSON.stringify({ payload }),
    },
    '保存命盘失败',
  );

  if (typeof data.id !== 'string' || !data.id.trim()) {
    throw new Error('保存命盘失败');
  }

  return data.id;
}

export async function updateSavedChart(type: UserChartType, id: string, payload: Record<string, unknown>, scope: ChartRequestScope = {}): Promise<void> {
  await requestChartsJson<{ success?: boolean }>(
    `/api/${type}/charts/update`,
    {
      ...chartRequestInit(scope, true),
      method: 'POST',
      body: JSON.stringify({ chartId: id, payload }),
    },
    '更新命盘失败',
  );
}

export async function setDefaultUserChart(type: UserChartType, id: string, scope: ChartRequestScope = {}) {
  const data = await requestChartsJson<RawUserChartBundle>(
    '/api/user/charts',
    {
      ...chartRequestInit(scope, true),
      method: 'PATCH',
      body: JSON.stringify({ type, id }),
    },
    '设置默认命盘失败',
  );
  return normalizeUserChartBundle(data).defaultChartIds;
}

export async function deleteUserChart(type: UserChartType, id: string, scope: ChartRequestScope = {}) {
  const params = new URLSearchParams({ type, id });
  await requestChartsJson<{ success?: boolean }>(
    `/api/user/charts?${params.toString()}`,
    {
      ...chartRequestInit(scope, true),
      method: 'DELETE',
      body: undefined,
    },
    '删除命盘失败',
  );
}
