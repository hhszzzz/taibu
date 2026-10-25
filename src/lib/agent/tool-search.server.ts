import 'server-only';
import { Type } from '@earendil-works/pi-ai';
import type { Extension, PromptSection } from '@earendil-works/pi-durable';
import { defineTool } from '@earendil-works/pi-durable';
import { rankDeferredTools, TOOL_SEARCH_LIMIT, TOOL_SEARCH_MAX_LIMIT, type ToolSearchCandidate } from 'taibu-core/mcp';
import { AGENT_CODEMODE_TOOL, AGENT_TOOL_SEARCH_TOOL, getAgentExtensionToolTitle } from './tool-catalog';

/**
 * Deferred tools are the low-frequency Taibu tools and the external MCP tools: offered only once the model asks for
 * them, so a request carries the tools a reading needs instead of every tool that exists. The ranking is Core's, shared
 * with the MCP servers' `tool_search`: Pi's own ranks with BM25 over Latin tokens, where a Chinese query finds nothing.
 */
export const AGENT_TOOL_SEARCH_LIMIT = TOOL_SEARCH_LIMIT;

/** What a search tells the model: the tools it may now call, each with the title and first line of its description. */
function loadedText(loaded: readonly string[], candidates: readonly ToolSearchCandidate[], titles: ReadonlyMap<string, string>) {
  const lines = loaded.map(name => {
    const title = titles.get(name) ?? getAgentExtensionToolTitle(name);
    const summary = candidates.find(candidate => candidate.name === name)?.description.trim().split(/\r?\n/u)[0] ?? '';
    return `- ${name}${title && title !== name ? `（${title}）` : ''}${summary ? `：${summary.slice(0, 160)}` : ''}`;
  });
  return `已加载 ${loaded.length} 个工具，从下一次模型调用起可用：\n${lines.join('\n')}`;
}

/** The user's own material among the deferred tools, named only when this task has it (search needs long-term memory). */
const DATA_TOOL_NAMES: ReadonlyArray<readonly [string, string]> = [['read_user_notes', '用户的每日笔记与心情'], ['search_conversations', '用户以往对话中的提问与结论']];

const toolSearchSection: PromptSection = {
  key: 'taibu_tool_search',
  render: input => {
    const deferred = input.agent.deferred;
    if (!deferred.length) return undefined;
    const data = DATA_TOOL_NAMES.filter(([name]) => deferred.some(tool => tool.name === name)).map(([, label]) => label);
    return [
      `还有 ${deferred.length} 个低频工具没有直接提供：八字的关系、五行、流年扫描详查，大运、四柱反推与两人合盘，紫微大限与飞星，择日，奇门／大六壬／占星／六爻的局部详查，${data.length ? `读取${data.join('、')}，` : ''}以及外部 MCP 工具。`,
      `需要其中某个工具时，先调用 tool_search 用中文关键词检索（例如「大运」「流年扫描」「合盘」「飞星四化」「择日」「宫位」「六爻动爻」${data.length ? '「笔记」「以往对话」' : ''}）。命中的工具从下一次模型调用起可用；同一对话内加载过的工具保持可用，压缩上下文后仍可用。已直接提供的排盘工具不必检索。`,
      ...(input.agent.tools.some(tool => tool.name === AGENT_CODEMODE_TOOL)
        ? ['代码模式脚本可以直接调用全部工具（包括尚未加载的），不必先检索。']
        : []),
    ].join('\n');
  },
};

/** The `tool_search` tool and its guidance; the tools it loads are the ones the registry marks deferred. */
export function createAgentToolSearchExtension(titles: ReadonlyMap<string, string>): Extension {
  return {
    name: 'taibu_tool_search',
    tools: [defineTool({
      name: AGENT_TOOL_SEARCH_TOOL,
      description: '按中文关键词检索本任务尚未提供的低频工具（详查、大运、流年扫描、合盘、飞星、择日、MCP 等），命中后从下一次模型调用起可用。',
      parameters: Type.Object({
        query: Type.String({ minLength: 1, description: '中文关键词，如「大运」「流年扫描」「合盘」「飞星四化」「择日」「宫位」' }),
        limit: Type.Optional(Type.Number({ description: `最多返回几个工具，默认 ${AGENT_TOOL_SEARCH_LIMIT}，最多 ${TOOL_SEARCH_MAX_LIMIT}` })),
      }),
      // Loading changes what the model is offered; a script has its own searchTools().
      callers: ['model'],
      replay: 'safe',
      execute: async ({ query, limit }, api, context) => {
        const requested = limit ?? AGENT_TOOL_SEARCH_LIMIT;
        if (!Number.isInteger(requested) || requested <= 0 || requested > TOOL_SEARCH_MAX_LIMIT)
          throw new Error(`limit 必须是 1–${TOOL_SEARCH_MAX_LIMIT} 的整数`);
        const candidates = (await api.agent(context)).deferred.map(tool => ({ name: tool.name, description: tool.description }));
        const loaded = rankDeferredTools(query, candidates, titles, requested);
        return {
          output: [{ type: 'text' as const, text: loaded.length ? loadedText(loaded, candidates, titles)
            : '没有匹配的工具。换一个说法，或用工具名再试；常见排盘工具已直接提供，不必检索。' }],
          details: { loaded, labels: loaded.map(name => titles.get(name) ?? name) },
          ...(loaded.length ? { control: { addTools: loaded } } : {}),
        };
      },
    })],
    sections: [toolSearchSection],
  };
}
