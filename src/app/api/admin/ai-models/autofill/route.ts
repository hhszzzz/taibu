/**
 * 从 models.dev 补全模型目录（管理员）
 *
 * POST: 逐个对话模型精确匹配目录，只补空缺（上下文、输出上限、思考等级、图片输入、没填的单价），已填的值不动；
 *       返回补了哪些模型的哪些字段，以及目录里找不到或保存失败的模型。
 */
import { NextRequest } from 'next/server';
import { jsonOk } from '@/lib/api-utils';
import { parseModelInput } from '@/lib/admin/ai-catalog';
import { CatalogError, listModels, updateModel } from '@/lib/admin/ai-catalog.server';
import { catalogRoute } from '@/lib/admin/ai-catalog-route.server';
import { exactModelsDevMatch, planModelsDevFill } from '@/lib/admin/models-dev';
import { allModelsDevModels } from '@/lib/admin/models-dev.server';

export async function POST(request: NextRequest) {
    return catalogRoute(request, '从 models.dev 补全', async () => {
        const [models, catalog] = await Promise.all([listModels(), allModelsDevModels()]);
        const updated: Array<{ name: string; changes: string[]; source: string }> = [];
        const unmatched: string[] = [];
        const failed: Array<{ name: string; error: string }> = [];
        let unchanged = 0;
        for (const { id, ...model } of models) {
            if (model.usageType !== 'chat') continue;
            const match = exactModelsDevMatch(catalog, [model.modelKey, ...model.sources.map(source => source.modelIdOverride ?? ''), model.displayName]);
            if (!match) { unmatched.push(model.displayName); continue; }
            const plan = planModelsDevFill(model, match);
            if (!plan.changes.length) { unchanged += 1; continue; }
            const parsed = parseModelInput(plan.input);
            if ('error' in parsed) { failed.push({ name: model.displayName, error: parsed.error }); continue; }
            try {
                await updateModel(id, parsed.value);
                updated.push({ name: model.displayName, changes: plan.changes, source: `${match.providerName} · ${match.id}` });
            } catch (error) {
                failed.push({ name: model.displayName, error: error instanceof CatalogError ? error.message : '保存失败' });
            }
        }
        return jsonOk({ updated, unchanged, unmatched, failed });
    });
}
