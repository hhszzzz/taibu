/**
 * 塔罗牌 API 路由
 *
 * 提供抽牌、每日一牌、牌阵解读等功能
 */
import { NextRequest, NextResponse } from 'next/server';
import { drawCards, drawForSpread, generateTarotReadingText, getDailyCard, TAROT_CARDS, TAROT_SPREADS, type DrawnCard, type TarotNumerology, type TarotSpread } from '@/lib/divination/tarot';
import { getAuthContext, jsonError, jsonOk } from '@/lib/api-utils';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    persistUserOwnedDivinationRecord,
    saveUserOwnedDivinationRecord,
    type DivinationRouteConfig,
    type InterpretInput,
} from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';
import { loadResolvedChartPromptDetailLevel } from '@/lib/ai/chart-prompt-detail';

interface TarotRequest {
    action: 'draw' | 'daily' | 'spread' | 'draw-only' | 'save' | 'interpret' | 'interpret_prepare' | 'interpret_persist' | 'list-spreads' | 'list-cards';
    spreadId?: string;
    count?: number;
    question?: string;
    cards?: DrawnCard[];
    seed?: string;
    allowReversed?: boolean;
    timezone?: string;
    readingId?: string;
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
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

// ─── Interpret pipeline config ───

interface TarotInterpretInput extends InterpretInput {
    cards: DrawnCard[];
    spreadId: string;
    question?: string;
    readingId?: string;
    seed?: string;
    birthDate?: string;
    numerology?: TarotNumerology;
}

function buildTarotMetadata(birthDate?: string, numerology?: TarotNumerology, seed?: string): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    if (birthDate) {
        metadata.birthDate = birthDate;
    }
    if (numerology) {
        metadata.numerology = numerology;
    }
    if (seed) {
        metadata.seed = seed;
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

const tarotInterpretConfig: DivinationRouteConfig<TarotInterpretInput> = {
    sourceType: 'tarot',
    tag: 'tarot',
    authMethod: 'userContext',
    personality: 'tarot',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.tarot_reading],
    parseInput: (body) => {
        const b = body as TarotRequest;
        if (!b.cards || b.cards.length === 0) {
            return { error: '请提供要解读的塔罗牌', status: 400 };
        }
        return {
            cards: b.cards,
            spreadId: b.spreadId || 'custom',
            question: b.question,
            readingId: b.readingId,
            seed: b.seed,
            birthDate: b.birthDate,
            numerology: b.numerology,
        };
    },
    resolvePromptContext: async (_input, auth) => ({
        userId: auth.userId,
        chartPromptDetailLevel: await loadResolvedChartPromptDetailLevel(auth.userId, 'tarot', {
            client: auth.db ?? undefined,
        }),
    }),
    buildPrompts: (input, promptContext) => {
        const spreadName = TAROT_SPREADS.find((spread) => spread.id === input.spreadId)?.name || input.spreadId || '自定义牌阵';
        const userPrompt = generateTarotReadingText({
            spreadName,
            spreadId: input.spreadId,
            question: input.question,
            cards: input.cards,
            seed: input.seed,
            numerology: input.numerology,
            birthDate: input.birthDate,
            detailLevel: promptContext?.chartPromptDetailLevel,
        });

        return { systemPrompt: '', userPrompt };
    },
    buildSourceData: (input, modelId, reasoningEnabled) => ({
        cards: input.cards,
        spread_id: input.spreadId,
        question: input.question || null,
        model_id: modelId,
        reasoning: reasoningEnabled,
        seed: input.seed || null,
        birth_date: input.birthDate || null,
        numerology: input.numerology || null,
    }),
    generateTitle: (input) => {
        const spreadName = TAROT_SPREADS.find((spread) => spread.id === input.spreadId)?.name || input.spreadId || '自定义';
        if (input.question?.trim()) {
            return `${input.question.trim().substring(0, 20)} - ${spreadName}`;
        }
        return `塔罗占卜 - ${spreadName}`;
    },
    buildHistoryBinding: (input) => ({
        type: 'tarot',
        payload: input.readingId
            ? {
                reading_id: input.readingId,
                metadata: buildTarotMetadata(input.birthDate, input.numerology, input.seed) || null,
            }
            : {
                spread_id: input.spreadId,
                question: input.question || null,
                cards: input.cards,
                metadata: buildTarotMetadata(input.birthDate, input.numerology, input.seed) || null,
            },
    }),
};

const handleInterpret = createInterpretHandler<TarotInterpretInput>(tarotInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<TarotInterpretInput>(tarotInterpretConfig);

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
            cards: input.cards!,
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
                        client: auth.db,
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
                            cards: input.cards,
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
            }
            case 'interpret':
                return handleInterpret(request, body as unknown as Record<string, unknown>);
            case 'interpret_prepare':
                return handleDirectPrepare(request, body as unknown as Record<string, unknown>);
            case 'interpret_persist':
                return handleDirectPersist(request, body as unknown as Record<string, unknown>);
            default:
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
