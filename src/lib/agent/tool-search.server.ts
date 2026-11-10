import 'server-only';
import type { ConversationId, Extension, Harness, PromptSection, ToolExecutionResult } from '@earendil-works/pi-durable';
import { num, obj, opt, str } from '@earendil-works/pi-schema';
import { defineTool, hook, ToolTask } from '@earendil-works/pi-durable';
import { rankDeferredTools, TOOL_SEARCH_LIMIT, TOOL_SEARCH_MAX_LIMIT, type ToolSearchCandidate } from 'taibu-core/mcp';
import { AGENT_CODEMODE_TOOL, AGENT_MCP_TOOL_PREFIX, AGENT_TOOL_SEARCH_TOOL, getAgentExtensionToolTitle } from './tool-catalog';

/**
 * Deferred tools are the low-frequency Taibu tools and the MCP tools of servers set to be searched: offered only once
 * the model asks for them, so a request carries the tools a reading needs instead of every tool that exists. The ranking is Core's, shared
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
const DATA_TOOL_KEYWORDS: Readonly<Record<string, string>> = {
  read_user_notes: '读取每日笔记 日记 心情 记录 随笔',
  search_conversations: '检索以往对话 历史对话 聊天记录 之前对话 上次',
};

const toolSearchSection: PromptSection = {
  key: 'taibu_tool_search',
  render: input => {
    const deferred = input.agent.deferred;
    if (!deferred.length) return undefined;
    const data = DATA_TOOL_NAMES.filter(([name]) => deferred.some(tool => tool.name === name)).map(([, label]) => label);
    const external = deferred.some(tool => tool.name.startsWith(AGENT_MCP_TOOL_PREFIX));
    return [
      `还有 ${deferred.length} 个低频工具没有直接提供：八字的关系、五行、流年扫描详查，大运、四柱反推、推算出生时辰与两人合盘，紫微宫位、运限与飞星，择日，奇门／大六壬／占星／六爻的局部详查${data.length ? `，读取${data.join('、')}` : ''}${external ? '，以及外部服务的工具' : ''}。`,
      `需要其中某个工具时，先调用 tool_search 检索：用中文关键词，或直接用方法正文里写的工具名（例如「bazi_wuxing」「大运」「流年扫描」「合盘」「飞星四化」「择日」「宫位」「六爻动爻」${data.length ? '「笔记」「以往对话」' : ''}${external ? '，外部工具也可用服务名或用途检索' : ''}）。命中的工具从下一次模型调用起可用；同一对话内加载过的工具保持可用，压缩上下文后仍可用。已直接提供的排盘工具不必检索。`,
      ...(input.agent.tools.some(tool => tool.name === AGENT_CODEMODE_TOOL)
        ? ['代码模式脚本可以直接调用全部工具（包括尚未加载的），不必先检索。']
        : []),
    ].join('\n');
  },
};

/** A direct call that only loaded its tool; the answer leaves the step out (durable-projection.server.ts). */
export function isAgentToolLoadCall(input: unknown, details: unknown) {
  if (!input || typeof input !== 'object' || !('kind' in input) || input.kind !== 'model' ||
    !('unoffered' in input) || input.unoffered !== true) return false;
  return !!details && typeof details === 'object' && 'loadedOnCall' in details;
}

/**
 * The `tool_search` tool and its guidance; the tools it loads are the ones the registry marks deferred. `searchTitles`
 * is what a query matches as the title (an external tool's title with its keywords); `titles` is what the result shows.
 * A direct call to a deferred tool that is not loaded yet loads it as a search would: Pi never runs a tool its request
 * did not offer, so the call ends `tool_unavailable` unrun, and the model calls again with the tool's parameters in
 * view. `onLoad` hears every tool a search or a call loaded into a conversation.
 */
export function createAgentToolSearchExtension(session: () => Harness, titles: ReadonlyMap<string, string>, searchTitles: ReadonlyMap<string, string>,
  onLoad: (conversationId: ConversationId, names: readonly string[]) => void): Extension {
  const indexedTitles = new Map(searchTitles);
  for (const [name, keywords] of Object.entries(DATA_TOOL_KEYWORDS)) {
    indexedTitles.set(name, `${indexedTitles.get(name) ?? ''} ${keywords}`.trim());
  }
  return {
    name: 'taibu_tool_search',
    tools: [defineTool({
      name: AGENT_TOOL_SEARCH_TOOL,
      description: '按中文关键词或工具名检索本任务尚未提供的低频工具（详查、大运、流年扫描、推时辰、合盘、紫微宫位与飞星、择日、外部服务等），命中后从下一次模型调用起可用。',
      parameters: obj({
        query: str({ minLength: 1, description: '中文关键词或工具名，如「大运」「流年扫描」「合盘」「飞星四化」「择日」「宫位」「bazi_wuxing」' }),
        limit: opt(num({ description: `最多返回几个工具，默认 ${AGENT_TOOL_SEARCH_LIMIT}，最多 ${TOOL_SEARCH_MAX_LIMIT}` })),
      }, { open: true }),
      // Loading changes what the model is offered; a script has its own searchTools().
      callers: ['model'],
      replay: 'safe',
      execute: async ({ query, limit }, api, context) => {
        const requested = limit ?? AGENT_TOOL_SEARCH_LIMIT;
        if (!Number.isInteger(requested) || requested <= 0 || requested > TOOL_SEARCH_MAX_LIMIT)
          throw new Error(`limit 必须是 1–${TOOL_SEARCH_MAX_LIMIT} 的整数`);
        const candidates = (await api.agent(context)).deferred.map(tool => ({ name: tool.name, description: tool.description }));
        const loaded = rankDeferredTools(query, candidates, indexedTitles, requested);
        return {
          output: [{ type: 'text' as const, text: loaded.length ? loadedText(loaded, candidates, titles)
            : '没有匹配的工具。换一个说法，或用工具名再试；常见排盘工具已直接提供，不必检索。' }],
          details: { loaded, labels: loaded.map(name => titles.get(name) ?? name) },
          ...(loaded.length ? { control: { addTools: loaded } } : {}),
        };
      },
    })],
    sections: [toolSearchSection],
    hooks: [hook(ToolTask, {
      afterTool: async (call, result, api, context) => {
        // A script's calls resolve among every tool it may call, and only a model-issued call's control applies.
        if (call.parent) return;
        let settled = result;
        if (result.diagnostics?.some(diagnostic => diagnostic.code === 'tool_unavailable')) {
          const agent = await (await session().conversation(api.conversationId, context))?.agent(context);
          // Only what a search could load: a name the model made up, or a tool this conversation lacks, stays unavailable.
          const tool = agent?.deferred.find(item => item.name === call.name);
          if (tool) settled = {
            output: [{ type: 'text', text: `这次调用没有执行：${tool.name} 是按需加载的工具，本次请求还没有提供它。\n${loadedText([tool.name], [tool], titles)}\n按它的参数说明再调用一次即可，不必向用户说明。` }],
            isError: true, details: { loadedOnCall: tool.name }, control: { addTools: [tool.name] },
          } satisfies ToolExecutionResult;
        }
        if (settled.control?.addTools?.length) onLoad(api.conversationId, settled.control.addTools);
        return settled === result ? undefined : settled;
      },
    })],
  };
}
