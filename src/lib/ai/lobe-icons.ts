/**
 * 模型可选的 lobehub 图标：校验与搜索。纯数据，服务端校验和单测都能加载；渲染见 components/ui/LobeIcon。
 */
import { LOBE_ICONS, type LobeIconEntry } from './lobe-icons.generated';
import { LOBE_MODEL_ICON_RULES } from './lobe-model-icons.generated';

export { LOBE_ICONS, type LobeIconEntry };

const IDS = new Set(LOBE_ICONS.map(icon => icon.id));

export function isLobeIconId(value: unknown): value is string {
    return typeof value === 'string' && IDS.has(value);
}

let modelRules: Array<readonly [string, RegExp[]]> | null = null;

/** 按模型 ID 认 lobehub 图标（如 `claude-…` → Claude），规则与顺序同 lobehub ModelIcon；认不出时为 null。 */
export function matchModelIcon(modelId: string | null | undefined): string | null {
    const id = modelId?.trim().toLowerCase();
    if (!id) return null;
    modelRules ??= LOBE_MODEL_ICON_RULES.map(([icon, keywords]) => [icon, keywords.map(keyword => new RegExp(keyword, 'i'))] as const);
    return modelRules.find(([, patterns]) => patterns.some(pattern => pattern.test(id)))?.[0] ?? null;
}

/** 按 ID 与名称搜索，不分大小写；完全相同、前缀、包含依次靠前，空查询按字母顺序列出。 */
export function searchLobeIcons(query: string, limit = 60): LobeIconEntry[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return LOBE_ICONS.slice(0, limit);
    const ranked: Array<{ icon: LobeIconEntry; rank: number }> = [];
    for (const icon of LOBE_ICONS) {
        const names = [icon.id.toLowerCase(), icon.title.toLowerCase()];
        const rank = names.some(name => name === needle) ? 0
            : names.some(name => name.startsWith(needle)) ? 1
                : names.some(name => name.includes(needle)) ? 2 : -1;
        if (rank >= 0) ranked.push({ icon, rank });
    }
    return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map(entry => entry.icon);
}
