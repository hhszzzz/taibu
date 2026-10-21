import { type NextRequest } from 'next/server';
import type { BirthTimeResolution } from '@/lib/divination/birth-time';
import { jsonError, jsonOk, requireUserContext, resolveRequestDbClient } from '@/lib/api-utils';
import {
    buildDefaultChartSettingsPayload,
    getUserSettingsSnapshot,
    normalizeUserSettings,
    sanitizeDefaultChartIds,
    toDefaultChartIds,
} from '@/lib/user/settings';

type ChartType = 'bazi' | 'ziwei';

type ChartRecord = BirthTimeResolution & {
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

function isChartType(value: unknown): value is ChartType {
    return value === 'bazi' || value === 'ziwei';
}

function getChartTable(type: ChartType) {
    return type === 'bazi' ? 'bazi_charts' : 'ziwei_charts';
}

async function loadDefaultChartIds(
    auth: Exclude<Awaited<ReturnType<typeof requireUserContext>>, { error: unknown }>,
) {
    const { settings, error } = await getUserSettingsSnapshot(auth.scoped, auth.user.id);
    return {
        defaultChartIds: toDefaultChartIds(settings),
        error,
    };
}

export async function GET(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const expectedUserId = request.headers.get('X-Expected-User-Id');
    if (expectedUserId !== null && expectedUserId !== auth.user.id) {
        return jsonError('账号已切换，请重新加载命盘', 409);
    }
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('获取命盘列表失败', 500);

    const [baziResult, ziweiResult, settingsResult] = await Promise.all([
        db
            .from('bazi_charts')
            .select('id, name, gender, birth_date, birth_time, birth_place, longitude, calendar_type, is_leap_month, timezone, disambiguation, created_at')
            .eq('user_id', auth.user.id)
            .order('created_at', { ascending: false }),
        db
            .from('ziwei_charts')
            .select('id, name, gender, birth_date, birth_time, birth_place, longitude, calendar_type, is_leap_month, timezone, disambiguation, created_at')
            .eq('user_id', auth.user.id)
            .order('created_at', { ascending: false }),
        loadDefaultChartIds(auth),
    ]);

    if (baziResult.error || ziweiResult.error || settingsResult.error) {
        console.error('[user/charts] failed to load chart bundle', {
            userId: auth.user.id,
            baziError: baziResult.error?.message || null,
            ziweiError: ziweiResult.error?.message || null,
            settingsError: settingsResult.error ? String(settingsResult.error) : null,
        });
        return jsonError('获取命盘列表失败', 500);
    }

    const baziCharts = (baziResult.data || []) as ChartRecord[];
    const ziweiCharts = (ziweiResult.data || []) as ChartRecord[];
    const defaultChartIds = sanitizeDefaultChartIds(settingsResult.defaultChartIds, {
        bazi: baziCharts.map((chart) => chart.id),
        ziwei: ziweiCharts.map((chart) => chart.id),
    });

    return jsonOk({
        baziCharts,
        ziweiCharts,
        defaultChartIds,
    });
}

export async function PATCH(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const expectedUserId = request.headers.get('X-Expected-User-Id');
    if (expectedUserId !== null && expectedUserId !== auth.user.id) {
        return jsonError('账号已切换，请重新加载命盘', 409);
    }
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('设置默认命盘失败', 500);

    let body: { type?: unknown; id?: unknown };
    try {
        body = await request.json() as { type?: unknown; id?: unknown };
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }

    if (!isChartType(body.type) || typeof body.id !== 'string' || !body.id.trim()) {
        return jsonError('缺少有效的命盘类型或命盘 ID', 400);
    }

    const { data: chart, error: chartError } = await db
        .from(getChartTable(body.type))
        .select('id')
        .eq('id', body.id)
        .eq('user_id', auth.user.id)
        .maybeSingle();

    if (chartError) {
        return jsonError('获取命盘失败', 500);
    }
    if (!chart) {
        return jsonError('命盘不存在', 404);
    }

    const payload = buildDefaultChartSettingsPayload(auth.user.id, body.type, body.id);

    const { data, error } = await db
        .from('user_settings')
        .upsert(payload, { onConflict: 'user_id' })
        .select('default_bazi_chart_id, default_ziwei_chart_id')
        .maybeSingle();

    if (error) {
        return jsonError('设置默认命盘失败', 500);
    }

    return jsonOk({
        defaultChartIds: toDefaultChartIds(normalizeUserSettings((data ?? null) as Record<string, unknown> | null)),
    });
}

export async function DELETE(request: NextRequest) {
    const auth = await requireUserContext(request);
    if ('error' in auth) return jsonError(auth.error.message, auth.error.status);
    const expectedUserId = request.headers.get('X-Expected-User-Id');
    if (expectedUserId !== null && expectedUserId !== auth.user.id) {
        return jsonError('账号已切换，请重新加载命盘', 409);
    }
    const db = resolveRequestDbClient(auth);
    if (!db) return jsonError('删除命盘失败', 500);

    const type = request.nextUrl.searchParams.get('type');
    const id = request.nextUrl.searchParams.get('id');

    if (!isChartType(type) || !id) {
        return jsonError('缺少有效的命盘类型或命盘 ID', 400);
    }

    const { defaultChartIds, error: settingsError } = await loadDefaultChartIds(auth);
    if (settingsError) {
        return jsonError('获取用户设置失败', 500);
    }

    const wasDefault = (type === 'bazi' ? defaultChartIds.bazi : defaultChartIds.ziwei) === id;
    if (wasDefault) {
        const payload = buildDefaultChartSettingsPayload(auth.user.id, type, null);
        const { error: updateError } = await db
            .from('user_settings')
            .upsert(payload, { onConflict: 'user_id' });
        if (updateError) {
            return jsonError('清理默认命盘失败', 500);
        }
    }

    const { data, error } = await db
        .from(getChartTable(type))
        .delete()
        .eq('id', id)
        .eq('user_id', auth.user.id)
        .select('id');

    if (error) {
        return jsonError('删除命盘失败', 500);
    }
    if (!Array.isArray(data) || data.length === 0) {
        return jsonError('命盘不存在', 404);
    }

    return jsonOk({
        success: true,
        defaultChartIds: wasDefault
            ? {
                ...defaultChartIds,
                [type]: null,
            }
            : defaultChartIds,
    });
}
