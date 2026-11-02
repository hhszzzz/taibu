/**
 * 塔罗牌 API 路由
 *
 * 提供抽牌、每日一牌、牌阵保存等功能
 */
import { NextRequest, NextResponse } from 'next/server';
import { drawCards, drawForSpread, getDailyCard, TAROT_CARDS, TAROT_SPREADS, type DrawnCard, type TarotNumerology, type TarotSpread } from '@/lib/divination/tarot';
import { getAuthContext, jsonError, jsonOk } from '@/lib/api-utils';
import { json } from '@/lib/db/sql-helpers';
import {
    persistUserOwnedDivinationRecord,
    saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';

interface TarotRequest {
    action: 'draw' | 'daily' | 'spread' | 'draw-only' | 'save' | 'list-spreads' | 'list-cards';
    spreadId?: string;
    count?: number;
    question?: string;
    cards?: DrawnCard[];
    seed?: string;
    allowReversed?: boolean;
    timezone?: string;
    readingId?: string;
    birthDate?: string;
    numerology?: TarotNumerology;
}

interface TarotResponse {
    success: boolean;
    data?: {
        cards?: DrawnCard[];
        spread?: TarotSpread;
        spreads?: TarotSpread[];
        allCards?: typeof TAROT_CARDS;
        interpretation?: string;
        reasoning?: string;
        dailyCard?: DrawnCard;
        readingId?: string | null;
        conversationId?: string | null;
        numerology?: TarotNumerology;
        seed?: string;
    };
    error?: string;
}

function buildTarotMetadata(birthDate?: string, numerology?: TarotNumerology, seed?: string): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    if (birthDate) metadata.birthDate = birthDate;
    if (numerology) metadata.numerology = numerology;
    if (seed) metadata.seed = seed;
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

const tarotSaveConfig = {
    tag: 'tarot',
    tableName: 'tarot_readings',
    responseKey: 'readingId' as const,
    validate: (input: TarotRequest) => (!input.spreadId || !input.cards || input.cards.length === 0)
        ? { error: '请提供牌阵与抽牌结果', status: 400 }
        : null,
    buildInsertPayload: (input: TarotRequest, userId: string) => {
        const metadata = buildTarotMetadata(input.birthDate, input.numerology, input.seed);
        return {
            user_id: userId,
            spread_id: input.spreadId!,
            question: input.question || null,
            cards: json(input.cards!) as never,
            ...(metadata ? { metadata } : {}),
        };
    },
};

async function buildDailyCardResponse(timezone?: string, seedScope?: string): Promise<NextResponse<TarotResponse>> {
    try {
        const dailyCard = await getDailyCard(new Date(), { timezone, seedScope });
        return jsonOk({ success: true, data: { dailyCard } });
    } catch (error) {
        if (error instanceof Error && error.message.includes('timezone')) {
            return jsonError(error.message, 400, { success: false });
        }
        throw error;
    }
}

export async function POST(request: NextRequest): Promise<NextResponse<TarotResponse> | Response> {
    try {
        const body: TarotRequest = await request.json();
        const { action, spreadId, count = 1, question, seed, allowReversed = true, timezone, birthDate, numerology } = body;

        switch (action) {
            case 'list-spreads':
                return jsonOk({ success: true, data: { spreads: TAROT_SPREADS } });
            case 'list-cards':
                return jsonOk({ success: true, data: { allCards: TAROT_CARDS } });
            case 'draw': {
                const auth = await getAuthContext(request);
                if (auth.authError) return jsonError(auth.authError.message, auth.authError.status, { success: false });
                const drawnCards = await drawCards(Math.min(count, 10), allowReversed, { seedScope: auth.user?.id });
                return jsonOk({ success: true, data: { cards: drawnCards } });
            }
            case 'daily': {
                const auth = await getAuthContext(request);
                if (auth.authError) return jsonError(auth.authError.message, auth.authError.status, { success: false });
                return buildDailyCardResponse(timezone, auth.user?.id);
            }
            case 'spread': {
                if (!spreadId) return jsonError('请指定牌阵ID', 400, { success: false });
                const auth = await getAuthContext(request);
                if (auth.authError) return jsonError(auth.authError.message, auth.authError.status, { success: false });
                const spreadResult = await drawForSpread(spreadId, allowReversed, { seed, seedScope: auth.user?.id, question, birthDate });
                if (!spreadResult) return jsonError('未找到指定牌阵', 404, { success: false });
                const spreadMetadata = buildTarotMetadata(birthDate, spreadResult.numerology || numerology, spreadResult.seed);
                let readingId: string | null = null;
                if (auth.user) {
                    const persisted = await persistUserOwnedDivinationRecord({
                        db: auth.db,
                        tag: 'tarot',
                        tableName: 'tarot_readings',
                        input: {
                            spreadId,
                            question,
                            cards: spreadResult.cards,
                            metadata: spreadMetadata,
                        },
                        userId: auth.user.id,
                        buildInsertPayload: (input, resolvedUserId) => ({
                            user_id: resolvedUserId,
                            spread_id: input.spreadId,
                            question: input.question || null,
                            cards: json(input.cards) as never,
                            ...(input.metadata ? { metadata: input.metadata } : {}),
                        }),
                    });
                    readingId = persisted.id;
                }
                return jsonOk({
                    success: true,
                    data: { spread: spreadResult.spread, cards: spreadResult.cards, readingId, numerology: spreadResult.numerology, seed: spreadResult.seed },
                });
            }
            case 'draw-only': {
                if (!spreadId) return jsonError('请指定牌阵ID', 400, { success: false });
                const auth = await getAuthContext(request);
                if (auth.authError) return jsonError(auth.authError.message, auth.authError.status, { success: false });
                const spreadResult = await drawForSpread(spreadId, allowReversed, { seed, seedScope: auth.user?.id, question, birthDate });
                if (!spreadResult) return jsonError('未找到指定牌阵', 404, { success: false });
                return jsonOk({
                    success: true,
                    data: { spread: spreadResult.spread, cards: spreadResult.cards, numerology: spreadResult.numerology, seed: spreadResult.seed },
                });
            }
            case 'save': {
                return saveUserOwnedDivinationRecord({
                    request,
                    input: body,
                    ...tarotSaveConfig,
                });
            }            default:
                return jsonError('未知的操作类型', 400, { success: false });
        }
    } catch (error) {
        console.error('塔罗牌 API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}

export async function GET(request: NextRequest): Promise<NextResponse<TarotResponse>> {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'daily';
    const timezone = searchParams.get('timezone') || undefined;

    switch (action) {
        case 'daily':
            return buildDailyCardResponse(timezone);
        case 'spreads':
            return jsonOk({ success: true, data: { spreads: TAROT_SPREADS } });
        case 'cards':
            return jsonOk({ success: true, data: { allCards: TAROT_CARDS } });
        default:
            return jsonError('使用 POST 方法进行抽牌和解读操作', 400, { success: false });
    }
}
