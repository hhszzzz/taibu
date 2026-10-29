/**
 * 六爻占卜 API 路由
 *
 * 提供 AI 解卦功能，包含传统六爻分析
 */
import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { saveUserOwnedDivinationRecord } from '@/lib/api/divination-pipeline';
import type { Hexagram, Yao, LiuQin } from '@/lib/divination/liuyao';

interface LiuyaoRequest {
    action: 'save' | 'update';
    question?: string;
    yongShenTargets?: LiuQin[];
    hexagram?: Hexagram;
    changedHexagram?: Hexagram;
    changedLines?: number[];
    yaos?: Yao[];
    dayStem?: string;
    divinationId?: string;
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

            case 'update': {
                if (!divinationId) return jsonError('缺少记录 ID', 400, { success: false });
                const parsedTargets = parseYongShenTargets(yongShenTargets, { required: true });
                if (parsedTargets.error) return jsonError(parsedTargets.error, 400, { success: false });
                const authResult = await requireUserContext(request);
                if ('error' in authResult) return jsonError(authResult.error.message, authResult.error.status, { success: false });
                const data = await authResult.db.tx((trx) => trx
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

