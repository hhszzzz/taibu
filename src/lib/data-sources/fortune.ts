import { calculateDailyFortune, calculateMonthlyFortune, calculateGenericDailyFortune, calculateGenericMonthlyFortune } from '@/lib/divination/fortune';
import { getCalendarAlmanac } from '@/lib/divination/calendar';
import { generateFortuneInterpretation } from '@/lib/divination/fortune-interpretations';
import type { BaziOutput as CoreBaziOutput } from 'taibu-core/bazi';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import type { ScopedDb } from '@/lib/db/context.server';
import { calculateBaziOutputFromStoredFields } from '@/lib/divination/bazi-record';
import { formatLocalDate, formatYearMonth } from '@/lib/local-date';

type FortuneData = { id: string; name: string; content: string; createdAt: string };

function formatYm(date: Date) {
    return formatYearMonth(date.getFullYear(), date.getMonth() + 1);
}

/** 黄历细项：日运问答从黄历页移交对话后，@今日运势 需要同时带上这一天宜忌。 */
function buildAlmanacSection(date: Date): string[] {
    const almanac = getCalendarAlmanac(date);
    return [
        `## 黄历（${formatLocalDate(date)}）`,
        `- 农历：${almanac.lunarDate}`,
        `- 干支：${almanac.ganZhi.year}年 ${almanac.ganZhi.month}月 ${almanac.ganZhi.day}日`,
        `- 生肖：年${almanac.shengXiao.year} 月${almanac.shengXiao.month} 日${almanac.shengXiao.day}`,
        `- 纳音：${almanac.naYin.year} ${almanac.naYin.month} ${almanac.naYin.day}`,
        `- 节气：${almanac.jieQi.current?.name || '无'}`,
        `- 宜：${almanac.yi.join('、') || '诸事不宜'}`,
        `- 忌：${almanac.ji.join('、') || '无'}`,
        `- 吉神：${almanac.jiShen.join('、') || '无'}`,
        `- 凶煞：${almanac.xiongSha.join('、') || '无'}`,
        `- 冲煞：${almanac.chongSha.chong}`,
        `- 空亡：${almanac.kongWang}`,
        `- 财神位：${almanac.shenWei.caiShen}`,
        `- 喜神位：${almanac.shenWei.xiShen}`,
        `- 福神位：${almanac.shenWei.fuShen}`,
        `- 值神：${almanac.zhiShen}`,
    ];
}

const BAZI_CHART_COLUMNS = [
    'id', 'name', 'gender', 'birth_date', 'birth_time', 'birth_place', 'longitude',
    'calendar_type', 'is_leap_month', 'timezone', 'disambiguation', 'day_master',
    'day_branch', 'created_at',
] as const;

async function loadPreferredBaziChartRow(db: ScopedDb, userId: string) {
    const settings = await db.tx((trx) => trx
        .selectFrom('user_settings')
        .select('default_bazi_chart_id')
        .where('user_id', '=', userId)
        .executeTakeFirst());

    const defaultId = settings?.default_bazi_chart_id ?? null;
    if (defaultId) {
        const preferred = await db.tx((trx) => trx
            .selectFrom('bazi_charts')
            .select(BAZI_CHART_COLUMNS)
            .where('user_id', '=', userId)
            .where('id', '=', defaultId)
            .executeTakeFirst());
        if (preferred) return preferred;
    }

    return await db.tx((trx) => trx
        .selectFrom('bazi_charts')
        .select(BAZI_CHART_COLUMNS)
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst());
}

async function getDefaultBaziChartForUser(userId: string, ctx?: DataSourceQueryContext): Promise<CoreBaziOutput | null> {
    const db = requireQueryDb(ctx);
    const data = await loadPreferredBaziChartRow(db, userId);
    if (!data) return null;
    return calculateBaziOutputFromStoredFields(data as Parameters<typeof calculateBaziOutputFromStoredFields>[0]);
}

export const dailyFortuneProvider: DataSourceProvider<FortuneData> = {
    type: 'daily_fortune',
    displayName: '今日运势',

    async list(_userId: string, _ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const now = new Date();
        const id = formatLocalDate(now);
        return [{
            id,
            type: 'daily_fortune',
            name: id,
            preview: '今日运势',
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
        const ymd = formatLocalDate(normalized);

        const baziChart = await getDefaultBaziChartForUser(userId, ctx);
        if (!baziChart) {
            const generic = calculateGenericDailyFortune(normalized);
            const content = [
                ...buildAlmanacSection(normalized),
                '',
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
            ...buildAlmanacSection(normalized),
            '',
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
        const now = new Date();
        const ym = formatYm(now);
        const createdAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        return [{
            id: ym,
            type: 'monthly_fortune',
            name: ym,
            preview: '本月运势',
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
        const ymLabel = formatYearMonth(year, month);
        const name = `本月运势（${ymLabel}）`;

        const baziChart = await getDefaultBaziChartForUser(userId, ctx);
        if (!baziChart) {
            const generic = calculateGenericMonthlyFortune(year, month);
            const content = [
                `## 本月运势（${ymLabel}）`,
                `- 综合：${generic.overall}`,
                `- 事业：${generic.career}`,
                `- 感情：${generic.love}`,
                `- 财运：${generic.wealth}`,
                `- 健康：${generic.health}`,
                `- 人际：${generic.social}`,
                `- 总结：${generic.summary}`,
            ].join('\n');
            return { id: ymLabel, name, content, createdAt };
        }

        const fortune = calculateMonthlyFortune(baziChart, year, month);
        const content = [
            `## 本月运势（${ymLabel}）`,
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

        return { id: ymLabel, name, content, createdAt };
    },

    formatForAI(data: FortuneData): string {
        return data.content;
    },

    summarize(data: FortuneData): string {
        return data.name;
    }
};
