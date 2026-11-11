import {
    calculateLiuyaoBundle,
    findHexagram,
    generateLiuyaoChartText,
    normalizeYongShenTargets,
    type LiuQin,
    type LiuyaoBundle,
    type Yao,
} from '@/lib/divination/liuyao';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';
import { applyListFilters } from '@/lib/db/data-source-filters';

type LiuyaoRow = {
    id: string;
    user_id: string | null;
    question: string | null;
    hexagram_code: string;
    changed_hexagram_code: string | null;
    changed_lines: unknown;
    yongshen_targets: unknown;
    created_at: string;
    conversation_id: string | null;
};

export const buildYaosFromCode = (hexagramCode: string, changedLines: number[]): Yao[] => {
    return hexagramCode.split('').map((value, index) => ({
        type: (parseInt(value, 10) as 0 | 1),
        change: changedLines.includes(index + 1) ? 'changing' : 'stable',
        position: index + 1,
    }));
};

type StoredLiuyaoRecord = {
    question?: unknown;
    hexagram_code?: unknown;
    changed_hexagram_code?: unknown;
    changed_lines?: unknown;
    yongshen_targets?: unknown;
    created_at?: unknown;
};

export type StoredLiuyaoBundle = {
    bundle: LiuyaoBundle;
    question: string;
    targets: LiuQin[];
    analyzed: boolean;
    createdAt: string;
};

/** 已存六爻记录统一重建盘面：有目标就做用神分析，否则输出全盘事实。 */
export function buildStoredLiuyaoBundle(row: StoredLiuyaoRecord): StoredLiuyaoBundle | null {
    const code = typeof row.hexagram_code === 'string' ? row.hexagram_code : '';
    const hexagram = /^[01]{6}$/.test(code) ? findHexagram(code) : undefined;
    if (!hexagram) return null;
    const changedHexagram = typeof row.changed_hexagram_code === 'string' ? findHexagram(row.changed_hexagram_code) : undefined;
    const changedLines = Array.isArray(row.changed_lines)
        ? row.changed_lines.filter((line): line is number => typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= 6)
        : [];
    const targets = Array.isArray(row.yongshen_targets) ? normalizeYongShenTargets(row.yongshen_targets) : [];
    const question = typeof row.question === 'string' ? row.question : '';
    const createdAt = row.created_at instanceof Date
        ? row.created_at.toISOString()
        : typeof row.created_at === 'string' ? row.created_at : '';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return null;
    const analyzed = targets.length > 0;
    const bundle = calculateLiuyaoBundle({
        yaos: buildYaosFromCode(code, changedLines),
        hexagram,
        changedHexagram,
        question,
        yongShenTargets: targets,
        date,
        requireYongShen: analyzed,
    });
    return { bundle, question, targets, analyzed, createdAt };
}

/** 缺占问或缺用神时的说明；有占问且有目标时不需要。 */
function storedLiuyaoNote(stored: StoredLiuyaoBundle): string {
    const asked = stored.question.trim();
    return [
        '## 占问说明',
        asked
            ? '- 本记录有占问事项，但没有记录用神目标；请按用户的占问事项自行取用神，再按盘面事实解读。'
            : '- 本记录起卦时未填写所问之事；卦象与起卦时间完整，可正常解读，不是残缺记录。',
        ...(!asked && stored.targets.length > 0 ? [`- 已记录的用神目标：${stored.targets.join('、')}。`] : []),
        `- 起卦时间：${stored.createdAt || '未记录'}`,
        asked
            ? '- 不要替用户改动所问；按所问取用神解读。'
            : stored.targets.length > 0
                ? '- 所问未明时先问清，再按所记录的用神目标结合盘面事实解读，不要替用户假设问题。'
                : '- 所问未明时先问清，再按所问取用神解读，期间只陈述盘面事实；不要因缺所问而拒绝看盘，也不要替用户假设问题。',
    ].join('\n');
}

/** 已存卦的模型文本：缺占问或缺用神时先放说明，再接 AI-safe 盘面事实。 */
export function formatStoredLiuyaoText(
    stored: StoredLiuyaoBundle,
    detailLevel: 'default' | 'more' | 'full' = 'default',
): string {
    const chart = generateLiuyaoChartText(stored.bundle.output, { detailLevel });
    if (stored.question.trim() && stored.targets.length > 0) return chart;
    return `${storedLiuyaoNote(stored)}\n\n${chart}`;
}

export const liuyaoProvider: DataSourceProvider<LiuyaoRow> = {
    type: 'liuyao_divination',
    displayName: '六爻记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx(async (trx) => {
            const query = applyListFilters(trx
                .selectFrom('liuyao_divinations')
                .select(['id', 'question', 'hexagram_code', 'changed_hexagram_code', 'created_at'])
                .where('user_id', '=', userId), ctx, ['question']);
            if (!query) return [];
            return (ctx?.offset ? query.offset(ctx.offset) : query)
                .orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute();
        });
        return (data || []).map((row) => {
            const baseHexagram = findHexagram(row.hexagram_code);
            const baseName = baseHexagram?.name || '未知卦';
            const changedHexagram = row.changed_hexagram_code ? findHexagram(row.changed_hexagram_code) : undefined;
            const changedName = changedHexagram?.name || (row.changed_hexagram_code ? '未知卦' : '');
            const hexagramDisplay = changedName ? `${baseName} → ${changedName}` : baseName;
            return {
                id: row.id,
                type: 'liuyao_divination',
                name: hexagramDisplay,
                preview: row.question
                    ? `问题：${row.question}`
                    : `本卦：${baseName}${changedName ? ` / 变卦：${changedName}` : ''}`,
                createdAt: row.created_at ?? '',
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<LiuyaoRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
        .selectFrom('liuyao_divinations')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst());
        return (data as LiuyaoRow) || null;
    },

    formatForAI(r: LiuyaoRow, ctx?: DataSourceQueryContext): string {
        const stored = buildStoredLiuyaoBundle(r);
        if (!stored) {
            return [
                '## 六爻占卜',
                r.question ? `- 问题：${r.question}` : '',
                `- 本卦：${r.hexagram_code}`,
                r.changed_hexagram_code ? `- 变卦：${r.changed_hexagram_code}` : '',
                '- 注：卦码或起卦时间不完整，无法重建完整盘面；请让用户重新起卦或查看原记录。',
            ].filter(Boolean).join('\n');
        }
        return formatStoredLiuyaoText(
            stored,
            stored.question.trim() && stored.analyzed ? (ctx?.chartPromptDetailLevel ?? 'default') : 'full',
        );
    },

    summarize(r: LiuyaoRow): string {
        return r.question || '六爻占卜';
    }
};
