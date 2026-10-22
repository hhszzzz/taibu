import { type NextRequest } from 'next/server';
import type { BirthTimeResolution } from '@/lib/divination/birth-time';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { deleteFromDynamic, selectFromDynamic } from '@/lib/db/sql-helpers';
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
    const { settings, error } = await getUserSettingsSnapshot(auth.db, auth.user.id);
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
    const chartColumns = [
        'id', 'name', 'gender', 'birth_date', 'birth_time', 'birth_place', 'longitude',
        'calendar_type', 'is_leap_month', 'timezone', 'disambiguation', 'created_at',
    ] as const;

    const [baziCharts, ziweiCharts, settingsResult] = await Promise.all([
        auth.db.tx((trx) => trx
            .selectFrom('bazi_charts')
            .select(chartColumns)
            .where('user_id', '=', auth.user.id)
            .orderBy('created_at', 'desc')
            .execute()) as Promise<ChartRecord[]>,
        auth.db.tx((trx) => trx
            .selectFrom('ziwei_charts')
            .select(chartColumns)
            .where('user_id', '=', auth.user.id)
            .orderBy('created_at', 'desc')
            .execute()) as Promise<ChartRecord[]>,
        loadDefaultChartIds(auth),
    ]).catch((error) => {
        console.error('[user/charts] failed to load chart bundle', {
            userId: auth.user.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return [null, null, null] as const;
    });

    if (!baziCharts || !ziweiCharts || !settingsResult) {
        return jsonError('获取命盘列表失败', 500);
    }
    if (settingsResult.error) {
        console.error('[user/charts] failed to load default chart ids', {
            userId: auth.user.id,
            error: String(settingsResult.error),
        });
        return jsonError('获取命盘列表失败', 500);
    }
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
    let body: { type?: unknown; id?: unknown };
    try {
        body = await request.json() as { type?: unknown; id?: unknown };
    } catch {
        return jsonError('请求体不是合法 JSON', 400);
    }

    if (!isChartType(body.type) || typeof body.id !== 'string' || !body.id.trim()) {
        return jsonError('缺少有效的命盘类型或命盘 ID', 400);
    }
    const chartType = body.type;
    const chartId = body.id;

    const chart = await auth.db.tx((trx) => selectFromDynamic(trx, getChartTable(chartType))
        .select('id')
        .where('id', '=', chartId)
        .where('user_id', '=', auth.user.id)
        .executeTakeFirst());

    if (!chart) {
        return jsonError('命盘不存在', 404);
    }

    const payload = buildDefaultChartSettingsPayload(auth.user.id, chartType, chartId);

    const data = await auth.db.tx((trx) => trx
        .insertInto('user_settings')
        .values(payload as never)
        .onConflict((conflict) => conflict.column('user_id').doUpdateSet(payload as never))
        .returning(['default_bazi_chart_id', 'default_ziwei_chart_id'])
        .executeTakeFirst());

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
        await auth.db.tx((trx) => trx
            .insertInto('user_settings')
            .values(payload as never)
            .onConflict((conflict) => conflict.column('user_id').doUpdateSet(payload as never))
            .execute());
    }

    const data = await auth.db.tx((trx) => deleteFromDynamic(trx, getChartTable(type))
        .where('id', '=', id)
        .where('user_id', '=', auth.user.id)
        .returning('id')
        .execute());

    if (data.length === 0) {
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
