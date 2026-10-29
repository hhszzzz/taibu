/**
 * 梅花易数 API 路由
 *
 * action: calculate | save
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-utils';
import { saveUserOwnedDivinationRecord } from '@/lib/api/divination-pipeline';
import {
  calculateMeihuaBundle,
  type MeihuaInput,
  type MeihuaWebBundle,
} from '@/lib/divination/meihua';

type MeihuaRequest = {
  action: 'calculate' | 'save';
  input?: MeihuaInput;
  resultData?: MeihuaWebBundle;
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
