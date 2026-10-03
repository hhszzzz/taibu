import { calculateDailyFortune, calculateMonthlyFortune, calculateGenericDailyFortune, calculateGenericMonthlyFortune } from '@/lib/divination/fortune';
import { generateFortuneInterpretation } from '@/lib/divination/fortune-interpretations';
import type { BaziOutput as CoreBaziOutput } from 'taibu-core/bazi';
import { getSystemAdminClient } from '@/lib/api-utils';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { calculateBaziOutputFromStoredFields } from '@/lib/divination/bazi-record';

type FortuneData = { id: string; name: string; content: string; createdAt: string };

function formatYmd(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatYm(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function loadPreferredBaziChartRow(
    supabase: NonNullable<DataSourceQueryContext['client']> | ReturnType<typeof getSystemAdminClient>,
    userId: string,
) {
    const { data: settings } = await supabase
        .from('user_settings')
        .select('default_bazi_chart_id')
        .eq('user_id', userId)
        .maybeSingle();

    const settingsRow = settings as null | { default_bazi_chart_id: string | null };
    const defaultId = settingsRow?.default_bazi_chart_id ?? null;
    const baseQuery = supabase
        .from('bazi_charts')
        .select('id, name, gender, birth_date, birth_time, birth_place, longitude, calendar_type, is_leap_month, day_master, day_branch, created_at')
        .eq('user_id', userId);

    if (defaultId) {
        const preferred = await baseQuery.eq('id', defaultId).maybeSingle();
        if (preferred.data) {
            return preferred.data;
        }
    }

    const fallback = await baseQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
    return fallback.data;
}

async function getDefaultBaziChartForUser(userId: string, ctx?: DataSourceQueryContext): Promise<CoreBaziOutput | null> {
    const supabase = ctx?.client ?? getSystemAdminClient();
    const data = await loadPreferredBaziChartRow(supabase, userId);
    if (!data) return null;
    const row = data as {
        gender: string | null;
        birth_date: string;
        birth_time: string | null;
        birth_place: string | null;
        longitude: number | null;
        calendar_type: string | null;
        is_leap_month: boolean | null;
    };
    return calculateBaziOutputFromStoredFields(row);
}

export const dailyFortuneProvider: DataSourceProvider<FortuneData> = {
    type: 'daily_fortune',
    displayName: '今日运势',

    async list(_userId: string, _ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        void _userId;
        void _ctx;
        const now = new Date();
        const id = formatYmd(now);
        return [{
            id,
            type: 'daily_fortune',
            name: `今日运势（${id}）`,
            preview: '用于 @ 引用今日运势',
            createdAt: now.toISOString()
        }];
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<FortuneData | null> {
        const normalized = (() => {
            if (id === 'today') return new Date();
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
            if (!match) return new Date();
            const y = Number(match[1]);
            const m = Number(match[2]);
            const d = Number(match[3]);
            const dt = new Date(y, m - 1, d);
            return Number.isNaN(dt.getTime()) ? new Date() : dt;
        })();
        const ymd = formatYmd(normalized);

        const baziChart = await getDefaultBaziChartForUser(userId, ctx);
        if (!baziChart) {
            const generic = calculateGenericDailyFortune(normalized);
            const content = [
                `## 今日运势（${ymd}）`,
                `- 综合：${generic.overall}`,
                `- 事业：${generic.career}`,
                `- 感情：${generic.love}`,
                `- 财运：${generic.wealth}`,
                `- 健康：${generic.health}`,
                `- 人际：${generic.social}`,
                `- 建议：${generic.advice.join('；')}`
            ].join('\n');
            return { id: ymd, name: `今日运势（${ymd}）`, content, createdAt: normalized.toISOString() };
        }

        const fortune = calculateDailyFortune(baziChart, normalized);
        const interpretation = generateFortuneInterpretation(
            fortune.tenGod,
            {
                overall: fortune.overall,
                career: fortune.career,
                love: fortune.love,
                wealth: fortune.wealth,
                health: fortune.health,
                social: fortune.social,
            },
            'colloquial'
        );

        const content = [
            `## 今日运势（${ymd}）`,
            `- 十神：${fortune.tenGod}`,
            `- 综合：${fortune.overall}`,
            `- 事业：${fortune.career}`,
            `- 感情：${fortune.love}`,
            `- 财运：${fortune.wealth}`,
            `- 健康：${fortune.health}`,
            `- 人际：${fortune.social}`,
            `- 幸运色：${fortune.luckyColor}`,
            `- 吉方位：${fortune.luckyDirection}`,
            interpretation.length ? `- 解读：${interpretation.join('；')}` : '',
            fortune.advice?.length ? `- 建议：${fortune.advice.join('；')}` : '',
        ].filter(Boolean).join('\n');

        return { id: ymd, name: `今日运势（${ymd}）`, content, createdAt: normalized.toISOString() };
    },

    formatForAI(data: FortuneData): string {
        return data.content;
    },

    summarize(data: FortuneData): string {
        return data.name;
    }
};

export const monthlyFortuneProvider: DataSourceProvider<FortuneData> = {
    type: 'monthly_fortune',
    displayName: '本月运势',

    async list(_userId: string, _ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        void _userId;
        void _ctx;
        const now = new Date();
        const ym = formatYm(now);
        const createdAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        return [{
            id: ym,
            type: 'monthly_fortune',
            name: `本月运势（${ym}）`,
            preview: '用于 @ 引用本月运势',
            createdAt
        }];
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<FortuneData | null> {
        const now = new Date();
        const ym = id === 'this-month' ? formatYm(now) : id;
        const match = /^(\d{4})-(\d{2})$/.exec(ym);
        const year = match ? Number(match[1]) : now.getFullYear();
        const month = match ? Number(match[2]) : (now.getMonth() + 1);
        const createdAt = new Date(year, month - 1, 1).toISOString();

        const baziChart = await getDefaultBaziChartForUser(userId, ctx);
        if (!baziChart) {
            const generic = calculateGenericMonthlyFortune(year, month);
            const content = [
                `## 本月运势（${String(year)}-${String(month).padStart(2, '0')}）`,
                `- 综合：${generic.overall}`,
                `- 事业：${generic.career}`,
                `- 感情：${generic.love}`,
                `- 财运：${generic.wealth}`,
                `- 健康：${generic.health}`,
                `- 人际：${generic.social}`,
                `- 总结：${generic.summary}`,
            ].join('\n');
            return { id: `${String(year)}-${String(month).padStart(2, '0')}`, name: `本月运势（${String(year)}-${String(month).padStart(2, '0')}）`, content, createdAt };
        }

        const fortune = calculateMonthlyFortune(baziChart, year, month);
        const content = [
            `## 本月运势（${String(year)}-${String(month).padStart(2, '0')}）`,
            `- 十神：${fortune.tenGod}`,
            `- 综合：${fortune.overall}`,
            `- 事业：${fortune.career}`,
            `- 感情：${fortune.love}`,
            `- 财运：${fortune.wealth}`,
            `- 健康：${fortune.health}`,
            `- 人际：${fortune.social}`,
            `- 总结：${fortune.summary}`,
            Array.isArray(fortune.keyDates) && fortune.keyDates.length
                ? `- 关键日：${fortune.keyDates.map(k => `${k.date}日${k.type ? `(${k.type})` : ''}：${k.desc}`).join('；')}`
                : '',
        ].filter(Boolean).join('\n');

        return { id: `${String(year)}-${String(month).padStart(2, '0')}`, name: `本月运势（${String(year)}-${String(month).padStart(2, '0')}）`, content, createdAt };
    },

    formatForAI(data: FortuneData): string {
        return data.content;
    },

    summarize(data: FortuneData): string {
        return data.name;
    }
};
