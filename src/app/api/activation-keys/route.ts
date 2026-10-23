/**
 * 激活Key API
 * 
 * 提供激活Key的管理和激活功能
 * - GET: 获取所有Key (管理员)
 * - POST: 创建Key或激活Key
 * - DELETE: 删除Key (管理员)
 */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminUser, requireUserContext } from "@/lib/api-utils";
import {
    createActivationKeys,
    getAllActivationKeys,
    deleteActivationKey,
    activateKey,
    type CreateKeyParams,
} from "@/lib/user/activation-keys";

/**
 * GET /api/activation-keys
 * 获取所有激活Key (管理员专用)
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdminUser(request);
        if ("error" in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const { searchParams } = new URL(request.url);
        const isUsedParam = searchParams.get("isUsed");
        const keyType = searchParams.get("keyType") as 'membership' | 'credits' | null;

        const filters: { isUsed?: boolean; keyType?: 'membership' | 'credits' } = {};
        if (isUsedParam !== null) {
            filters.isUsed = isUsedParam === "true";
        }
        if (keyType) {
            filters.keyType = keyType;
        }

        const keys = await getAllActivationKeys(filters);
        return jsonOk({ success: true, data: keys });
    } catch (error) {
        console.error("[api/activation-keys] GET error:", error);
        return jsonError("服务器错误", 500);
    }
}

/**
 * POST /api/activation-keys
 * 创建Key (管理员) 或 激活Key (普通用户)
 */
export async function POST(request: NextRequest) {
    try {
        let body;
        try { body = await request.json(); } catch { return jsonError('请求体不是合法 JSON', 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('请求体无效', 400);

        // 判断是创建还是激活
        if (body.action === "create") {
            const auth = await requireAdminUser(request);
            if ("error" in auth) {
                return jsonError(auth.error.message, auth.error.status);
            }

            const params: CreateKeyParams = {
                keyType: body.keyType,
                membershipType: body.membershipType,
                creditsAmount: body.creditsAmount,
                count: body.count ?? 1,
            };

            const result = await createActivationKeys(auth.user.id, params);
            return result.success ? jsonOk(result) : jsonError(result.error || '创建激活码失败', 400);
        } else if (body.action === "activate") {
            const auth = await requireUserContext(request);
            if ("error" in auth) {
                return jsonError(auth.error.message, auth.error.status);
            }
            // 激活Key - 普通用户可用
            const keyCode = typeof body.keyCode === "string" ? body.keyCode.trim() : "";
            if (!keyCode) {
                return jsonError("请输入激活码", 400);
            }

            const result = await activateKey(auth.user.id, keyCode);
            return result.success ? jsonOk(result) : jsonError(result.error || '激活失败', 400);
        } else {
            return jsonError("无效的操作", 400);
        }
    } catch (error) {
        console.error("[api/activation-keys] POST error:", error);
        return jsonError("服务器错误", 500);
    }
}

/**
 * DELETE /api/activation-keys
 * 删除激活Key (管理员专用)
 */
export async function DELETE(request: NextRequest) {
    try {
        const auth = await requireAdminUser(request);
        if ("error" in auth) {
            return jsonError(auth.error.message, auth.error.status);
        }

        const { searchParams } = new URL(request.url);
        const keyId = searchParams.get("id");

        if (!keyId) {
            return jsonError("缺少Key ID", 400);
        }

        const success = await deleteActivationKey(keyId);
        return jsonOk({ success });
    } catch (error) {
        console.error("[api/activation-keys] DELETE error:", error);
        return jsonError("服务器错误", 500);
    }
}
