/**
 * 关系合盘 API 路由
 */
import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-utils';
import { type HepanResult, getHepanTypeName } from '@/lib/divination/hepan';
import {
    createDirectInterpretHandlers,
    createInterpretHandler,
    type DivinationRouteConfig,
    type InterpretInput,
    saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

interface HepanRequest {
    action: 'analyze' | 'analyze_prepare' | 'analyze_persist' | 'save';
    result?: HepanResult;
    chartId?: string;
    modelId?: string;
    reasoning?: boolean;
    stream?: boolean;
}

// ─── Interpret pipeline config ───

interface HepanInterpretInput extends InterpretInput {
    result: HepanResult;
    chartId?: string;
}

const hepanInterpretConfig: DivinationRouteConfig<HepanInterpretInput> = {
    sourceType: 'hepan',
    tag: 'hepan',
    personality: 'hepan',
    allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.hepan_chart],
    parseInput: (body) => {
        const b = body as HepanRequest;
        if (!b.result) return { error: '请提供合盘结果', status: 400 };
        return { result: b.result, chartId: b.chartId };
    },
    buildPrompts: (input) => {
        const { result } = input;
        const typeName = getHepanTypeName(result.type);
        const dimensionsSummary = result.dimensions
            .map(d => `${d.name}: ${d.score}分 - ${d.description}`)
            .join('\n');
        const conflictsSummary = result.conflicts.length > 0
            ? result.conflicts.map(c => `[${c.severity}] ${c.title}: ${c.description}`).join('\n')
            : '无明显冲突';

        const userPrompt = `合盘类型：${typeName}

双方信息：
- ${result.person1.name}：${result.person1.year}年${result.person1.month}月${result.person1.day}日
- ${result.person2.name}：${result.person2.year}年${result.person2.month}月${result.person2.day}日

综合契合度：${result.overallScore}分

各维度分析：
${dimensionsSummary}

潜在冲突点：
${conflictsSummary}

请为这对关系提供深度分析和相处建议。`;

        return { systemPrompt: '', userPrompt };
    },
    buildSourceData: (input, modelId, reasoningEnabled) => ({
        type: input.result.type,
        person1_name: input.result.person1.name,
        person1_birth: input.result.person1,
        person2_name: input.result.person2.name,
        person2_birth: input.result.person2,
        compatibility_score: input.result.overallScore,
        dimensions: input.result.dimensions,
        conflicts: input.result.conflicts,
        model_id: modelId,
        reasoning: reasoningEnabled,
    }),
    generateTitle: (input) => {
        const typeNames: Record<string, string> = {
            love: '情侣合盘', business: '商业合伙', family: '亲子关系',
        };
        return `${input.result.person1.name} & ${input.result.person2.name} - ${typeNames[input.result.type] || '合盘分析'}`;
    },
    buildHistoryBinding: (input) => ({
        type: 'hepan',
        payload: input.chartId
            ? {
                chart_id: input.chartId,
            }
            : {
                type: input.result.type,
                person1_name: input.result.person1.name,
                person1_birth: input.result.person1,
                person2_name: input.result.person2.name,
                person2_birth: input.result.person2,
                compatibility_score: input.result.overallScore,
                result_data: input.result,
            },
    }),
};

const handleInterpret = createInterpretHandler<HepanInterpretInput>(hepanInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers<HepanInterpretInput>(hepanInterpretConfig);

export async function POST(request: NextRequest) {
    try {
        const body: HepanRequest = await request.json();
        const { action } = body;

        if (action === 'save') {
            return saveUserOwnedDivinationRecord({
                request,
                tag: 'hepan',
                tableName: 'hepan_charts',
                responseKey: 'chartId',
                input: body as unknown as Record<string, unknown>,
                validate: () => (!body.result)
                    ? { error: '请提供合盘结果', status: 400 }
                    : null,
                buildInsertPayload: (_input, userId) => {
                    const result = body.result!;
                    return {
                        user_id: userId,
                        type: result.type,
                        person1_name: result.person1.name,
                        person1_birth: result.person1,
                        person2_name: result.person2.name,
                        person2_birth: result.person2,
                        compatibility_score: result.overallScore,
                        result_data: result,
                    };
                },
            });
        }

        if (action === 'analyze') {
            return handleInterpret(request, body as unknown as Record<string, unknown>);
        }

        if (action === 'analyze_prepare') {
            return handleDirectPrepare(request, body as unknown as Record<string, unknown>);
        }

        if (action === 'analyze_persist') {
            return handleDirectPersist(request, body as unknown as Record<string, unknown>);
        }

        return jsonError('未知操作', 400, { success: false });
    } catch (error) {
        console.error('[hepan] API 错误:', error);
        return jsonError('服务器错误', 500, { success: false });
    }
}
