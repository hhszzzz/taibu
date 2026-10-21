/**
 * 六爻占卜 API 路由
 *
 * 提供 AI 解卦功能，包含传统六爻分析
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    type DivinationRouteConfig,
    type InterpretInput,
    saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';
import {
    calculateLiuyaoBundle,
    generateLiuyaoChartText,
    type Hexagram,
    type Yao,
    type LiuQin,
} from '@/lib/divination/liuyao';
import { generateLiuyaoTitle } from '@/lib/ai/ai-analysis';
import { loadResolvedChartPromptDetailLevel } from '@/lib/ai/chart-prompt-detail';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

interface LiuyaoRequest {
    action: 'interpret' | 'interpret_prepare' | 'interpret_persist' | 'save' | 'update';
    question?: string;
    yongShenTargets?: LiuQin[];
    hexagram?: Hexagram;
    changedHexagram?: Hexagram;
    changedLines?: number[];
    yaos?: Yao[];
    dayStem?: string;
    divinationId?: string;
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
}

function computeChangedCode(yaos: Yao[] | undefined, changedLines: number[] | undefined, hasChanged: boolean): string | undefined {
    if (!hasChanged || !yaos) return undefined;
    return yaos.map((y, i) =>
        changedLines?.includes(i + 1) ? (y.type === 1 ? 0 : 1) : y.type
    ).join('');
}

const LIU_QIN_VALUES: LiuQin[] = ['父母', '兄弟', '子孙', '妻财', '官鬼'];

function parseYongShenTargets(
    value: unknown,
    options: { required: boolean }
): { targets: LiuQin[]; error?: string } {
    if (value == null) {
        return options.required ? { targets: [], error: '请至少选择一个分析目标' } : { targets: [] };
    }
    if (!Array.isArray(value)) return { targets: [], error: '分析目标格式错误' };
    if (value.length === 0) {
        return options.required ? { targets: [], error: '请至少选择一个分析目标' } : { targets: [] };
    }
    const unique = new Set<LiuQin>();
    for (const item of value) {
        if (typeof item !== 'string' || !LIU_QIN_VALUES.includes(item as LiuQin)) {
            return { targets: [], error: '分析目标包含非法值' };
        }
        unique.add(item as LiuQin);
    }
    if (unique.size === 0 && options.required) return { targets: [], error: '请至少选择一个分析目标' };
    return { targets: Array.from(unique) };
}

function parseQuestionInput(value: unknown): { question: string; error?: string } {
    if (value == null) return { question: '' };
    if (typeof value !== 'string') return { question: '', error: '问题格式错误' };
    return { question: value };
}

interface LiuyaoInterpretInput extends InterpretInput {
    hexagram: Hexagram;
    changedHexagram?: Hexagram;
    changedLines?: number[];
    yaos?: Yao[];
    question: string;
    divinationId?: string;
    requestedTargets?: unknown;
}

type LiuyaoInterpretContext = {
    userId: string;
    chartPromptDetailLevel: Awaited<ReturnType<typeof loadResolvedChartPromptDetailLevel>>;
    analysisDate: Date;
    effectiveQuestion: string;
    yongShenTargets: LiuQin[];
    hexagramCode: string;
    changedCode?: string;
    traditionalInfo: string;
};

const liuyaoInterpretConfig: DivinationRouteConfig<LiuyaoInterpretInput, LiuyaoInterpretContext> = {
    sourceType: 'liuyao',
    tag: 'liuyao',
    authMethod: 'userContext',
    personality: 'liuyao',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.liuyao_divination],
    parseInput: (body) => {
        const request = body as LiuyaoRequest;
        if (!request.hexagram) return { error: '请提供卦象', status: 400 };

        const parsedQuestion = parseQuestionInput(request.question);
        if (parsedQuestion.error) return { error: parsedQuestion.error, status: 400 };

        return {
            hexagram: request.hexagram,
            changedHexagram: request.changedHexagram,
            changedLines: request.changedLines,
            yaos: request.yaos,
            question: parsedQuestion.question,
            divinationId: request.divinationId,
            requestedTargets: request.yongShenTargets,
        };
    },
    resolvePromptContext: async (input, auth) => {
        const { userId, db } = auth;
        if (!db) {
            return { error: '认证上下文缺失', status: 500 };
        }
        let analysisDate = new Date();
        let effectiveQuestion = input.question;
        let persistedTargets = input.requestedTargets;

        if (input.divinationId) {
            const data = await db.tx((trx) => trx
                .selectFrom('liuyao_divinations')
                .select(['created_at', 'question', 'yongshen_targets'])
                .where('id', '=', input.divinationId as string)
                .where('user_id', '=', userId)
                .executeTakeFirst());

            if (data) {
                if (data.created_at) analysisDate = new Date(data.created_at);
                if (!effectiveQuestion.trim() && typeof data.question === 'string') {
                    effectiveQuestion = data.question;
                }
                if (input.requestedTargets == null) {
                    persistedTargets = data.yongshen_targets;
                }
            }
        }

        if (!effectiveQuestion.trim()) {
            return { error: '请先明确问题后再解卦', status: 400 };
        }

        const parsedTargets = parseYongShenTargets(persistedTargets, { required: true });
        if (parsedTargets.error) {
            return { error: parsedTargets.error, status: 400 };
        }

        const chartPromptDetailLevel = await loadResolvedChartPromptDetailLevel(userId, 'liuyao', { db });
        const bundle = input.yaos
            ? calculateLiuyaoBundle({
                yaos: input.yaos,
                question: effectiveQuestion,
                date: analysisDate,
                yongShenTargets: parsedTargets.targets,
                hexagram: input.hexagram,
                changedHexagram: input.changedHexagram,
            })
            : null;

        return {
            userId,
            chartPromptDetailLevel,
            analysisDate,
            effectiveQuestion,
            yongShenTargets: parsedTargets.targets,
            hexagramCode: bundle?.hexagramCode || '',
            changedCode: bundle?.changedCode,
            traditionalInfo: bundle
                ? generateLiuyaoChartText(bundle.output, { detailLevel: chartPromptDetailLevel })
                : '',
        };
    },
    buildPrompts: (_input, context) => ({
        systemPrompt: '',
        userPrompt: `${context?.traditionalInfo || ''}\n\n请根据以上卦象信息，为求卦者详细解读此卦。`,
    }),
    buildSourceData: (input, modelId, reasoningEnabled, context) => ({
        hexagram_code: context?.hexagramCode || '',
        hexagram_name: input.hexagram.name,
        changed_hexagram_code: context?.changedCode || null,
        changed_hexagram_name: input.changedHexagram?.name,
        changed_lines: input.changedLines,
        question: context?.effectiveQuestion || null,
        yongshen_targets: context?.yongShenTargets || [],
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input, context) =>
        generateLiuyaoTitle(context?.effectiveQuestion, input.hexagram.name, input.changedHexagram?.name),
    formatSuccessResponse: ({ content, reasoning, conversationId }) => ({
        success: true,
        data: {
            interpretation: content,
            reasoning,
            conversationId,
        },
    }),
    buildHistoryBinding: (input, _userId, context) => ({
        type: 'liuyao',
        payload: input.divinationId
            ? {
                divination_id: input.divinationId,
                yongshen_targets: context?.yongShenTargets || [],
            }
            : {
                question: context?.effectiveQuestion || '',
                yongshen_targets: context?.yongShenTargets || [],
                hexagram_code: context?.hexagramCode || '',
                changed_hexagram_code: context?.changedCode || null,
                changed_lines: input.changedLines,
            },
    }),
};

const handleInterpret = createInterpretHandler<LiuyaoInterpretInput, LiuyaoInterpretContext>(liuyaoInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<LiuyaoInterpretInput, LiuyaoInterpretContext>(liuyaoInterpretConfig);

export async function POST(request: NextRequest) {
    try {
        const body: LiuyaoRequest = await request.json();
        const { action, question, yongShenTargets, changedHexagram, changedLines, yaos, divinationId } = body;

        switch (action) {
            case 'save': {
                const parsedQuestion = parseQuestionInput(question);
                if (parsedQuestion.error) return jsonError(parsedQuestion.error, 400, { success: false });
                const needsTargets = Boolean(parsedQuestion.question.trim());
                const parsedTargets = parseYongShenTargets(yongShenTargets, { required: needsTargets });
                if (parsedTargets.error) return jsonError(parsedTargets.error, 400, { success: false });
                const hexagramCode = yaos?.map(y => y.type).join('') || '';
                const changedCode = computeChangedCode(yaos, changedLines, Boolean(changedHexagram));
                return saveUserOwnedDivinationRecord({
                    request,
                    tag: 'liuyao',
                    tableName: 'liuyao_divinations',
                    responseKey: 'divinationId',
                    input: body as unknown as Record<string, unknown>,
                    buildInsertPayload: (_input, userId) => ({
                        user_id: userId,
                        question: parsedQuestion.question,
                        yongshen_targets: parsedTargets.targets.length > 0 ? parsedTargets.targets : null,
                        hexagram_code: hexagramCode,
                        changed_hexagram_code: changedCode,
                        changed_lines: changedLines,
                    }),
                });
            }

            case 'interpret':
                return handleInterpret(request, body as unknown as Record<string, unknown>);

            case 'interpret_prepare':
                return handleDirectPrepare(request, body as unknown as Record<string, unknown>);

            case 'interpret_persist':
                return handleDirectPersist(request, body as unknown as Record<string, unknown>);

            case 'update': {
                if (!divinationId) return jsonError('缺少记录 ID', 400, { success: false });
                const parsedTargets = parseYongShenTargets(yongShenTargets, { required: true });
                if (parsedTargets.error) return jsonError(parsedTargets.error, 400, { success: false });
                const authResult = await requireUserContext(request);
                if ('error' in authResult) return jsonError(authResult.error.message, authResult.error.status, { success: false });
                const data = await authResult.scoped.tx((trx) => trx
                    .updateTable('liuyao_divinations')
                    .set({ yongshen_targets: parsedTargets.targets } as never)
                    .where('id', '=', divinationId)
                    .where('user_id', '=', authResult.user.id)
                    .returning('id')
                    .execute());
                if (data.length === 0) return jsonError('记录不存在或无权限', 404, { success: false });
                return jsonOk({ success: true, data: { divinationId, yongShenTargets: parsedTargets.targets } });
            }

            default:
                return jsonError('未知操作', 400, { success: false });
        }
    } catch (error) {
        console.error('[liuyao] API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}

/* PLACEHOLDER_TRADITIONAL_INFO */
