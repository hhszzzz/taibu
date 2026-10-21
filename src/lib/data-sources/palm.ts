import { PALM_ANALYSIS_TYPES } from '@/lib/divination/palm';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import { requireQueryDb, type DataSourceProvider, type DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type PalmRow = {
    id: string;
    user_id: string;
    analysis_type: string | null;
    hand_type: string | null;
    created_at: string;
    conversation_id: string | null;
    conversation?: { messages?: unknown; source_data?: Record<string, unknown> } | null;
};

const extractConversationAnalysis = (conversation?: { messages?: unknown } | null): string | null => {
    const messages = Array.isArray(conversation?.messages) ? conversation?.messages : [];
    const assistant = messages.find((m: { role?: string; content?: string }) => m?.role === 'assistant' && m?.content);
    return assistant?.content || null;
};

const HAND_TYPE_LABELS: Record<string, string> = {
    left: '左手',
    right: '右手',
    both: '双手',
};

function getPalmHandLabel(handType: string | null | undefined): string {
    return handType ? (HAND_TYPE_LABELS[handType] || handType) : '';
}

function getPalmAnalysisTypeLabel(type: string | null | undefined): string {
    return PALM_ANALYSIS_TYPES.find((item) => item.id === type)?.name || type || '综合分析';
}

export const palmProvider: DataSourceProvider<PalmRow> = {
    type: 'palm_reading',
    displayName: '手相记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const db = requireQueryDb(ctx);
        const limit = ctx?.limit ?? 50;
        const data = await db.tx((trx) => trx
            .selectFrom('palm_readings')
            .select(['id', 'analysis_type', 'hand_type', 'created_at'])
            .where('user_id', '=', userId)
            .orderBy('created_at', 'desc')
            .limit(limit)
            .execute());
        return (data || []).map((row) => {
            const typeName = getPalmAnalysisTypeLabel(row.analysis_type);
            const handName = getPalmHandLabel(row.hand_type);
            const previewParts = [
                handName ? `手：${handName}` : '',
                row.analysis_type ? `类型：${typeName}` : ''
            ].filter(Boolean);
            return {
                id: row.id,
                type: 'palm_reading',
                name: `手相分析 - ${handName ? `${handName} ${typeName}` : typeName}`,
                preview: previewParts.length ? previewParts.join(' / ') : '手相分析记录',
                createdAt: row.created_at ?? '',
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<PalmRow | null> {
        const db = requireQueryDb(ctx);
        const data = await db.tx((trx) => trx
            .selectFrom('palm_readings')
            .selectAll()
            .where('id', '=', id)
            .where('user_id', '=', userId)
            .executeTakeFirst());
        if (!data) return null;
        const conversation = data.conversation_id
            ? await db.tx((trx) => trx
                .selectFrom('conversations')
                .select(['messages', 'source_data'])
                .where('id', '=', data.conversation_id as string)
                .executeTakeFirst()) ?? null
            : null;
        return { ...data, conversation } as PalmRow;
    },

    formatForAI(r: PalmRow): string {
        const analysisText = extractConversationAnalysis(r.conversation);
        const sourceData = r.conversation?.source_data || {};
        const handLabel = getPalmHandLabel(r.hand_type);
        const typeLabel = getPalmAnalysisTypeLabel(r.analysis_type);
        return [
            '## 手相分析记录',
            r.hand_type ? `- 手：${handLabel}` : '',
            r.analysis_type ? `- 类型：${typeLabel}` : '',
            typeof sourceData?.question === 'string' && sourceData.question ? `- 提问：${sourceData.question}` : '',
            analysisText ? `\n【AI解读】\n${analysisText}` : ''
        ].filter(Boolean).join('\n');
    },

    summarize(r: PalmRow): string {
        const handName = getPalmHandLabel(r.hand_type);
        const typeName = getPalmAnalysisTypeLabel(r.analysis_type);
        return handName ? `手相(${handName} · ${typeName})` : `手相(${typeName})`;
    }
};
