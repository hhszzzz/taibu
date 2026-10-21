import 'server-only';
import type { PromptSection } from '@earendil-works/pi-durable';
import { METHOD_CONVENTIONS } from 'taibu-core/mcp';
import { ANALYSIS_METHODS } from './methods.server';

/**
 * The cards the model chooses from: those whose system tools are offered, plus, with `chartless`, those that read no
 * chart (解梦); then the shared tool conventions. Nothing when no card's tools are offered.
 */
export function renderMethodDirectory(offered: readonly string[], chartless = true): string | undefined {
    const names = new Set(offered);
    const cards = ANALYSIS_METHODS.flatMap(method => {
        const tools = method.tools.filter(tool => names.has(tool));
        if (method.tools.length ? !tools.length : !chartless) return [];
        return [{ charted: tools.length > 0, line: `- ${method.id}（${method.title}）— ${method.description}${tools.length ? `工具：${tools.join(', ')}` : '无需排盘工具。'}` }];
    });
    if (!cards.some(card => card.charted)) return undefined;
    return ['按问题选择方法卡。Core 结果提供盘面；每个体系首次解读前必须调用 load_analysis_method 加载对应 id 的方法卡，并遵守其断法、工具流程与输出要求。短回答也不得跳过，目录不能代替正文。同一体系有多张卡时按用户点名的流派选，未点名用与体系同名的默认卡。',
        ...cards.map(card => card.line),
        METHOD_CONVENTIONS].join('\n');
}

/** The method directory as a system prompt section; `chartless: false` where only chart-reading cards can be loaded. */
export function methodSection(chartless = true): PromptSection {
    return { key: 'taibu_methods', render: input => renderMethodDirectory(input.agent.tools.map(tool => tool.name), chartless) };
}

export const taibuMethodSection = methodSection();
