/**
 * models.dev 目录查询（管理员）
 *
 * GET ?q=模型ID：返回公开的上下文窗口、输出上限与能力，供模型编辑器一键填入。
 */
import { NextRequest } from 'next/server';
import { jsonOk } from '@/lib/api-utils';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';
import { searchModelsDev } from '@/lib/admin/models-dev.server';

export async function GET(request: NextRequest) {
    return catalogRoute(request, '查询 models.dev', async () => {
        const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
        if (query.length < 2) return jsonOk({ models: [] });
        return jsonOk({ models: await searchModelsDev(query) });
    });
}
