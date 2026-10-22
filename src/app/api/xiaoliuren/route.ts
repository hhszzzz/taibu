/**
 * 小六壬 API 路由
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
  buildXiaoliurenCanonicalText,
  calculateXiaoliurenBundle,
  type XiaoliurenWebBundle,
} from '@/lib/divination/xiaoliuren';
import { SOURCE_CHART_TYPE_MAP } from '@/lib/visualization/chart-types';

type XiaoliurenRequest = {
  action: 'calculate' | 'save' | 'interpret' | 'interpret_prepare' | 'interpret_persist';
  date?: string;
  question?: string;
  resultData?: XiaoliurenWebBundle;
  divinationId?: string;
  modelId?: string;
  reasoning?: boolean;
};

type XiaoliurenInterpretInput = InterpretInput & {
  resultData: XiaoliurenWebBundle;
  divinationId?: string;
};

type XiaoliurenRouteError = { error: string; status: number };

function isXiaoliurenRouteError(
  value: XiaoliurenWebBundle | XiaoliurenRouteError,
): value is XiaoliurenRouteError {
  return 'error' in value;
}

function resolveCanonicalXiaoliurenBundle(input: unknown): XiaoliurenWebBundle | XiaoliurenRouteError {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: '请提供完整的起课参数', status: 400 };
  }
  const candidate = input as { date?: unknown; question?: unknown };
  if (typeof candidate.date !== 'string') {
    return { error: '请提供起课时间', status: 400 };
  }
  if (candidate.question !== undefined && typeof candidate.question !== 'string') {
    return { error: '占问事项格式无效', status: 400 };
  }
  try {
    return calculateXiaoliurenBundle({
      date: candidate.date,
      question: candidate.question,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '起课参数无效',
      status: 400,
    };
  }
}

function resolveCanonicalXiaoliurenResultData(
  value: unknown,
): XiaoliurenWebBundle | XiaoliurenRouteError {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('input' in value)) {
    return { error: '请提供完整的起课结果', status: 400 };
  }
  return resolveCanonicalXiaoliurenBundle((value as { input?: unknown }).input);
}

const xiaoliurenInterpretConfig: DivinationRouteConfig<XiaoliurenInterpretInput> = {
  sourceType: 'xiaoliuren',
  tag: 'xiaoliuren',
  personality: 'xiaoliuren',
  allowedChartTypes: [...SOURCE_CHART_TYPE_MAP.xiaoliuren_divination],
  parseInput: (body) => {
    const request = body as XiaoliurenRequest;
    const resultData = resolveCanonicalXiaoliurenResultData(request.resultData);
    if (isXiaoliurenRouteError(resultData)) return resultData;
    return {
      resultData,
      divinationId: request.divinationId,
    };
  },
  buildPrompts: (input) => ({
    systemPrompt: '',
    userPrompt: `${buildXiaoliurenCanonicalText(input.resultData.result)}\n\n请结合月、日、时三步推演，给出简洁、可执行的解读。`,
  }),
  buildSourceData: (input, modelId, reasoning) => ({
    question: input.resultData.input.question ?? null,
    lunar_month: input.resultData.lunarMonth,
    lunar_day: input.resultData.lunarDay,
    shichen: input.resultData.result.input.shichen,
    final_status: input.resultData.result.hourStatus,
    model_id: modelId,
    reasoning,
  }),
  generateTitle: (input) => `小六壬 · ${input.resultData.result.hourStatus}`,
  buildHistoryBinding: (input) => input.divinationId
    ? {
      type: 'xiaoliuren',
      payload: { divination_id: input.divinationId },
    }
    : null,
};

const handleInterpret = createInterpretHandler(xiaoliurenInterpretConfig);
const { handleDirectPrepare, handleDirectPersist } = createDirectInterpretHandlers(xiaoliurenInterpretConfig);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as XiaoliurenRequest;

    switch (body.action) {
      case 'calculate': {
        const resultData = resolveCanonicalXiaoliurenBundle({ date: body.date, question: body.question });
        if (isXiaoliurenRouteError(resultData)) {
          return jsonError(resultData.error, resultData.status, { success: false });
        }
        return jsonOk({ success: true, data: resultData });
      }

      case 'save': {
        const resultData = resolveCanonicalXiaoliurenResultData(body.resultData);
        if (isXiaoliurenRouteError(resultData)) {
          return jsonError(resultData.error, resultData.status, { success: false });
        }
        return saveUserOwnedDivinationRecord({
          request,
          tag: 'xiaoliuren',
          tableName: 'xiaoliuren_divinations',
          responseKey: 'divinationId',
          input: { ...body, resultData },
          buildInsertPayload: (input, userId) => ({
            user_id: userId,
            question: input.resultData!.input.question ?? null,
            solar_datetime: input.resultData!.solarDateTime,
            lunar_month: input.resultData!.lunarMonth,
            lunar_day: input.resultData!.lunarDay,
            is_leap_month: input.resultData!.isLeapMonth,
            shichen: input.resultData!.result.input.shichen,
            final_status: input.resultData!.result.hourStatus,
            input_data: input.resultData!.input,
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
    console.error('[xiaoliuren] 路由错误:', error);
    if (error instanceof Error) {
      return jsonError(error.message, 400, { success: false });
    }
    return jsonError('服务器内部错误', 500, { success: false });
  }
}
