import { getSystemAdminClient } from '@/lib/api-utils';
import {
    calculateLiuyaoBundle,
    calculateGanZhiTime,
    calculateKongWangByPillar,
    findHexagram,
    formatGanZhiTime,
    generateLiuyaoChartText,
    type Yao,
} from '@/lib/divination/liuyao';
import { getHexagramText } from '@/lib/divination/hexagram-texts';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

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

const buildYaosFromCode = (hexagramCode: string, changedLines: number[]): Yao[] => {
    return hexagramCode.split('').map((value, index) => ({
        type: (parseInt(value, 10) as 0 | 1),
        change: changedLines.includes(index + 1) ? 'changing' : 'stable',
        position: index + 1,
    }));
};

export const liuyaoProvider: DataSourceProvider<LiuyaoRow> = {
    type: 'liuyao_divination',
    displayName: '六爻记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('liuyao_divinations')
            .select('id, question, hexagram_code, changed_hexagram_code, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; question: string | null; hexagram_code: string; changed_hexagram_code: string | null; created_at: string }) => {
            const baseHexagram = findHexagram(row.hexagram_code);
            const baseName = baseHexagram?.name || '未知卦';
            const changedHexagram = row.changed_hexagram_code ? findHexagram(row.changed_hexagram_code) : undefined;
            const changedName = changedHexagram?.name || (row.changed_hexagram_code ? '未知卦' : '');
            const hexagramDisplay = changedName ? `${baseName} → ${changedName}` : baseName;
            return {
                id: row.id,
                type: 'liuyao_divination',
                name: `六爻 - ${hexagramDisplay}`,
                preview: row.question
                    ? `问题：${row.question}`
                    : `本卦：${baseName}${changedName ? ` / 变卦：${changedName}` : ''}`,
                createdAt: row.created_at
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<LiuyaoRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('liuyao_divinations')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as LiuyaoRow) || null;
    },

    formatForAI(r: LiuyaoRow, ctx?: DataSourceQueryContext): string {
        const changedLines = Array.isArray(r.changed_lines) ? r.changed_lines.filter((v): v is number => typeof v === 'number') : [];
        const yongShenTargets = Array.isArray(r.yongshen_targets)
            ? r.yongshen_targets.filter((item): item is '父母' | '兄弟' | '子孙' | '妻财' | '官鬼' =>
                typeof item === 'string' && ['父母', '兄弟', '子孙', '妻财', '官鬼'].includes(item)
            )
            : [];
        const question = r.question || '';
        const hasQuestion = question.trim().length > 0;
        const shouldAnalyze = Boolean(r.hexagram_code) && hasQuestion && yongShenTargets.length > 0;
        let effectiveGanZhiTime;
        let effectiveKongWangByPillar;
        const baseHexagram = findHexagram(r.hexagram_code);
        const changedHexagram = r.changed_hexagram_code ? findHexagram(r.changed_hexagram_code) : undefined;
        if (shouldAnalyze && baseHexagram) {
            const bundle = calculateLiuyaoBundle({
                yaos: buildYaosFromCode(r.hexagram_code, changedLines),
                question,
                date: new Date(r.created_at),
                yongShenTargets,
                hexagram: baseHexagram,
                changedHexagram,
            });

            return generateLiuyaoChartText(bundle.output, {
                detailLevel: ctx?.chartPromptDetailLevel,
            });
        } else {
            effectiveGanZhiTime = calculateGanZhiTime(new Date(r.created_at));
            effectiveKongWangByPillar = calculateKongWangByPillar(effectiveGanZhiTime);
        }
        const ganZhiTime = formatGanZhiTime(effectiveGanZhiTime);
        const kongWangSummary = `年${effectiveKongWangByPillar.year.xun}（${effectiveKongWangByPillar.year.kongDizhi.join(' ')}）；月${effectiveKongWangByPillar.month.xun}（${effectiveKongWangByPillar.month.kongDizhi.join(' ')}）；日${effectiveKongWangByPillar.day.xun}（${effectiveKongWangByPillar.day.kongDizhi.join(' ')}）；时${effectiveKongWangByPillar.hour.xun}（${effectiveKongWangByPillar.hour.kongDizhi.join(' ')}）`;

        const hexText = baseHexagram ? getHexagramText(baseHexagram.name) : undefined;
        const changedHexText = changedHexagram ? getHexagramText(changedHexagram.name) : undefined;

        return [
            '## 六爻占卜',
            question ? `- 问题：${question}` : '',
            `- 本卦：${r.hexagram_code}${baseHexagram ? `（${baseHexagram.name}）` : ''}`,
            r.changed_hexagram_code ? `- 变卦：${r.changed_hexagram_code}${changedHexagram ? `（${changedHexagram.name}）` : ''}` : '',
            changedLines.length ? `- 动爻：${changedLines.join('、')}` : '',
            yongShenTargets.length ? `- 分析目标：${yongShenTargets.join('、')}` : '- 分析目标：缺失（历史旧记录）',
            ganZhiTime ? `- 起卦时间：${ganZhiTime}` : '',
            kongWangSummary ? `- 旬空（年/月/日/时）：${kongWangSummary}` : '',
            kongWangSummary ? '- 注：六爻断卦判空亡以”日旬空”为主，年/月/时旬空供参考。' : '',
            hexText ? `- 本卦卦辞：${hexText.gua}` : '',
            hexText ? `- 本卦象辞：${hexText.xiang}` : '',
            changedHexText ? `- 变卦卦辞：${changedHexText.gua}` : '',
            changedHexText ? `- 变卦象辞：${changedHexText.xiang}` : '',
            ...(changedLines.length > 0 && hexText?.yao
                ? changedLines
                    .map(pos => hexText.yao[pos - 1])
                    .filter((y): y is NonNullable<typeof y> => Boolean(y))
                    .map(y => `- 动爻爻辞（${y.name}）：${y.text}`)
                : []),
            !hasQuestion ? '- 当前记录未提供明确问题，仅可作为原始卦象记录，不应正式断卦。' : '',
        ].filter(Boolean).join('\n');
    },

    summarize(r: LiuyaoRow): string {
        return r.question || '六爻占卜';
    }
};
