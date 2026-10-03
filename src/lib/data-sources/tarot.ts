import { getSystemAdminClient } from '@/lib/api-utils';
import { generateTarotReadingText, TAROT_SPREADS } from '@/lib/divination/tarot';
import type { DataSourceSummary } from '@/lib/data-sources/types';
import type { DataSourceProvider, DataSourceQueryContext } from '@/lib/data-sources/provider.server';

type TarotRow = {
    id: string;
    user_id: string;
    spread_id: string;
    question: string | null;
    cards: unknown;
    metadata?: Record<string, unknown> | null;
    created_at: string;
    conversation_id: string | null;
};

export const tarotProvider: DataSourceProvider<TarotRow> = {
    type: 'tarot_reading',
    displayName: '塔罗记录',

    async list(userId: string, ctx?: DataSourceQueryContext): Promise<DataSourceSummary[]> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const limit = ctx?.limit ?? 50;
        const { data, error } = await supabase
            .from('tarot_readings')
            .select('id, spread_id, question, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw new Error(error.message);
        return (data || []).map((row: { id: string; spread_id: string; question: string | null; created_at: string }) => {
            const spreadName = TAROT_SPREADS.find(spread => spread.id === row.spread_id)?.name || row.spread_id || '塔罗占卜';
            return {
                id: row.id,
                type: 'tarot_reading',
                name: `塔罗 - ${spreadName}`,
                preview: row.question ? `问题：${row.question}` : `牌阵：${spreadName}`,
                createdAt: row.created_at
            };
        });
    },

    async get(id: string, userId: string, ctx?: DataSourceQueryContext): Promise<TarotRow | null> {
        const supabase = ctx?.client ?? getSystemAdminClient();
        const { data, error } = await supabase
            .from('tarot_readings')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as TarotRow) || null;
    },

    formatForAI(reading: TarotRow, ctx?: DataSourceQueryContext): string {
        const spreadName = TAROT_SPREADS.find(spread => spread.id === reading.spread_id)?.name || reading.spread_id || '塔罗占卜';
        const birthDate = typeof reading.metadata?.birthDate === 'string' ? reading.metadata.birthDate : undefined;
        const seed = typeof reading.metadata?.seed === 'string' ? reading.metadata.seed : undefined;
        return generateTarotReadingText({
            spreadName,
            spreadId: reading.spread_id,
            question: reading.question,
            cards: reading.cards,
            seed,
            numerology: (reading.metadata?.numerology || null) as Parameters<typeof generateTarotReadingText>[0]['numerology'],
            birthDate,
            detailLevel: ctx?.chartPromptDetailLevel,
        });
    },

    summarize(reading: TarotRow): string {
        const spreadName = TAROT_SPREADS.find(spread => spread.id === reading.spread_id)?.name || reading.spread_id || '塔罗占卜';
        return reading.question ? `${spreadName} - ${reading.question}` : spreadName;
    }
};
