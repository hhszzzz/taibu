/**
 * 梅花易数 API 路由
 *
 * action: calculate | save | interpret | interpret_prepare | interpret_persist
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import {
  createDirectInterpretHandlers,
  createInterpretHandler,
  type DivinationRouteConfig,
  type InterpretInput,
  saveUserOwnedDivinationRecord,
} from '@/lib/api/divination-pipeline';
import {
  buildMeihuaCanonicalText,
  calculateMeihuaBundle,
  type MeihuaInput,
  type MeihuaWebBundle,
} from '@/lib/divination/meihua';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

type MeihuaRequest = {
  action: 'calculate' | 'save' | 'interpret' | 'interpret_prepare' | 'interpret_persist';
  input?: MeihuaInput;
  resultData?: MeihuaWebBundle;
  divinationId?: string;
  modelId?: string;
  reasoning?: boolean;
};

type MeihuaInterpretInput = InterpretInput & {
  resultData: MeihuaWebBundle;
  divinationId?: string;
};

type MeihuaRouteError = { error: string; status: number };

function isMeihuaInput(value: unknown): value is MeihuaInput {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isMeihuaRouteError(value: MeihuaWebBundle | MeihuaRouteError): value is MeihuaRouteError {
  return 'error' in value;
}

function resolveCanonicalMeihuaBundle(input: unknown): MeihuaWebBundle | MeihuaRouteError {
  if (!isMeihuaInput(input)) {
    return { error: '请提供完整的起卦参数', status: 400 };
  }
  try {
    return calculateMeihuaBundle(input);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '起卦参数无效',
      status: 400,
    };
  }
}

function resolveCanonicalMeihuaResultData(value: unknown): MeihuaWebBundle | MeihuaRouteError {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('input' in value)) {
    return { error: '请提供完整的起卦结果', status: 400 };
  }
  return resolveCanonicalMeihuaBundle((value as { input?: unknown }).input);
}

const meihuaInterpretConfig: DivinationRouteConfig<MeihuaInterpretInput> = {
  sourceType: 'meihua',
  tag: 'meihua',
  personality: 'meihua',
  allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.meihua_divination],
  parseInput: (body) => {
    const request = body as MeihuaRequest;
    const resultData = resolveCanonicalMeihuaResultData(request.resultData);
    if (isMeihuaRouteError(resultData)) return resultData;
    return {
      resultData,
      divinationId: request.divinationId,
    };
  },
  buildPrompts: (input) => ({
    systemPrompt: '',
    userPrompt: `${buildMeihuaCanonicalText(input.resultData.result)}\n\n请围绕所问之事，按体用、生克、动爻与阶段推演给出清晰解读。`,
  }),
  buildSourceData: (input, modelId, reasoning) => ({
    question: input.resultData.input.question,
    method: input.resultData.result.castMeta.method,
    main_hexagram: input.resultData.result.mainHexagram.name,
    changed_hexagram: input.resultData.result.changedHexagram?.name ?? null,
    moving_line: input.resultData.result.movingLine,
    model_id: modelId,
    reasoning,
  }),
  generateTitle: (input) => `梅花易数 · ${input.resultData.result.mainHexagram.name}`,
  buildHistoryBinding: (input) => input.divinationId
    ? {
      type: 'meihua',
      payload: { divination_id: input.divinationId },
    }
    : null,
};

const handleInterpret = createInterpretHandler(meihuaInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers(meihuaInterpretConfig);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as MeihuaRequest;

    switch (body.action) {
      case 'calculate': {
        const resultData = resolveCanonicalMeihuaBundle(body.input);
        if (isMeihuaRouteError(resultData)) {
          return jsonError(resultData.error, resultData.status, { success: false });
        }
        return jsonOk({ success: true, data: resultData });
      }

      case 'save': {
        const resultData = resolveCanonicalMeihuaBundle(body.input);
        if (isMeihuaRouteError(resultData)) {
          return jsonError(resultData.error, resultData.status, { success: false });
        }
        return saveUserOwnedDivinationRecord({
          request,
          tag: 'meihua',
          tableName: 'meihua_divinations',
          responseKey: 'divinationId',
          input: { ...body, input: resultData.input, resultData },
          buildInsertPayload: (input, userId) => ({
            user_id: userId,
            question: input.input!.question.trim(),
            method: input.input!.method ?? 'time',
            cast_datetime: input.input!.date,
            main_hexagram: input.resultData!.result.mainHexagram.name,
            changed_hexagram: input.resultData!.result.changedHexagram?.name ?? null,
            input_data: input.input,
            result_data: input.resultData,
          }),
        });
      }

      case 'interpret':
        return handleInterpret(request, body as unknown as Record<string, unknown>);

      case 'interpret_prepare':
        return handleDirectPrepare(request, body as unknown as Record<string, unknown>);

      case 'interpret_persist':
        return handleDirectPersist(request, body as unknown as Record<string, unknown>);

      default:
        return jsonError(`未知操作: ${String(body.action)}`, 400, { success: false });
    }
  } catch (error) {
    console.error('[meihua] 路由错误:', error);
    if (error instanceof Error) {
      return jsonError(error.message, 400, { success: false });
    }
    return jsonError('服务器内部错误', 500, { success: false });
  }
}
