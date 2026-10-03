import { getSystemAdminClient } from '@/lib/api-utils';
import { PALM_ANALYSIS_TYPES } from '@/lib/divination/palm';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

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
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('palm_readings')
            .select('id, analysis_type, hand_type, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; analysis_type: string | null; hand_type: string | null; created_at: string }) => {
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
                createdAt: row.created_at
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<PalmRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('palm_readings')
            .select('*, conversation:conversations(messages, source_data)')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as PalmRow) || null;
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
