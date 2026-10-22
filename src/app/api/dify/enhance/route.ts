/**
 * Dify 增强 API 路由
 *
 * 处理文件上传和网络搜索请求，调用 Dify 工作流
 * POST /api/dify/enhance
 */

import { NextRequest } from 'next/server';
import { callDifyWorkflow, isDifyAvailable } from '@/lib/ai/dify';
import { checkDifyAccess } from '@/lib/ai/dify-access';
import { getEffectiveMembershipType, MembershipResolutionError } from '@/lib/user/membership-server';
import type { DifyMode } from '@/types';
import { jsonError, jsonOk, requireUserContext } from '@/lib/api-utils';
import { getGlobalAIFeatureGuardResponse } from '@/lib/api/ai-feature-guard';

export async function POST(request: NextRequest) {
    try {
        const featureGuardResponse = await getGlobalAIFeatureGuardResponse();
        if (featureGuardResponse) return featureGuardResponse;

        // 检查 Dify API 是否可用
        if (!isDifyAvailable()) {
            return jsonError('Dify 服务未配置', 503, { success: false });
        }

        const auth = await requireUserContext(request);
        if ('error' in auth) {
            return jsonError(auth.error.message, auth.error.status, { success: false });
        }
        const userId = auth.user.id;

        // 解析 multipart/form-data
        const formData = await request.formData();
        const mode = formData.get('mode') as DifyMode | null;
        const query = formData.get('query') as string | null;
        const file = formData.get('file') as File | null;

        // 文件大小限制 10MB
        if (file && file.size > 10 * 1024 * 1024) {
            return jsonError('文件大小不能超过 10MB', 400, { success: false });
        }

        // 验证 mode 参数
        if (!mode || !['file', 'web', 'all'].includes(mode)) {
            return jsonError('无效的 mode 参数', 400, { success: false });
        }

        // 获取用户会员等级
        const membershipType = await getEffectiveMembershipType(userId, { db: auth.db });

        // 权限校验
        const accessResult = checkDifyAccess(membershipType, mode);
        if (!accessResult.allowed) {
            return jsonError(accessResult.reason ?? '无权限使用该功能', 403, { success: false, code: 'MEMBERSHIP_REQUIRED' });
        }

        // 调用 Dify 工作流
        const result = await callDifyWorkflow({
            mode,
            query: query || undefined,
            file: file || undefined,
            userId,
        });

        if (!result.success) {
            return jsonError(result.error ?? 'Dify 工作流调用失败', 500, { success: false });
        }

        return jsonOk({
            success: true,
            data: result.data,
        });
    } catch (error) {
        if (error instanceof MembershipResolutionError) {
            return jsonError(error.message, 500, { success: false });
        }
        console.error('[dify/enhance] Error:', error);
        return jsonError('服务暂时不可用', 500, { success: false });
    }
}
