import { METHOD_CARDS, METHOD_CONVENTIONS, METHOD_PRINCIPLES, METHOD_SYSTEMS } from './methods.generated.js';

/** A method card as written in skills/taibu-divination/methods: who reads, how to judge, which tools in what order, what to write. */
export interface MethodCardSource {
  name: string;
  title: string;
  system: string;
  version: string;
  description: string;
  role: string;
  method: string;
  workflow: string;
  output: string;
}

/** A card and the Core tools of its system, chart first; a method that needs no chart has none. */
export interface AnalysisMethod {
  id: string;
  title: string;
  system: string;
  version: string;
  description: string;
  tools: string[];
}

/** An MCP prompt for one card; its only argument is the user's question. */
export interface MethodPrompt {
  name: string;
  title: string;
  description: string;
  arguments: [{ name: 'question'; description: string; required: false }];
}

export interface MethodPromptResult {
  description: string;
  messages: [{ role: 'user'; content: { type: 'text'; text: string } }];
}

export { METHOD_CONVENTIONS, METHOD_PRINCIPLES };

export const METHOD_PROMPT_QUESTION = '要问的事或要解的梦，可附出生时间、起卦方式等资料；留空时先询问用户';

const CARDS = new Map(METHOD_CARDS.map(card => [card.name, card]));
const TOOL_SYSTEMS = new Map(Object.entries(METHOD_SYSTEMS).flatMap(([system, tools]) => tools.map(tool => [tool, system] as const)));

function describe(card: MethodCardSource): AnalysisMethod {
  return { id: card.name, title: card.title, system: card.system, version: card.version, description: card.description, tools: [...(METHOD_SYSTEMS[card.system] ?? [])] };
}

/** A card by its id, or the default card of the system a Core tool belongs to. */
function cardOf(id: string): MethodCardSource {
  const system = TOOL_SYSTEMS.get(id);
  const card = CARDS.get(id) ?? (system === undefined ? undefined : CARDS.get(system));
  if (!card) throw new Error(`未知的分析方法：${id}`);
  return card;
}

/** Every card: systems in registry order, each system's default card first. */
export function listAnalysisMethods(): AnalysisMethod[] {
  return METHOD_CARDS.map(describe);
}

/** A card by its id or by one of its system's Core tools; undefined when neither names one. */
export function findAnalysisMethod(id: string): AnalysisMethod | undefined {
  return CARDS.has(id) || TOOL_SYSTEMS.has(id) ? describe(cardOf(id)) : undefined;
}

/** The system a Core tool belongs to. */
export function getToolSystem(tool: string): string | undefined {
  return TOOL_SYSTEMS.get(tool);
}

/** The whole card, for a model that calls the tools itself. */
export function renderMethodGuide(id: string): string {
  const card = cardOf(id);
  return `# ${card.title}\n\n## 角色\n\n${card.role}\n\n## 断法\n\n${card.method}\n\n## 工具流程\n\n${card.workflow}\n\n## 输出要求\n\n${card.output}\n`;
}

/**
 * The card without its tool workflow, for a conversation that is given the chart instead of calling tools;
 * `brief` keeps only the role and the output rules, for a prompt that must leave room for several systems' data.
 */
export function renderMethodPersona(id: string, brief = false): string {
  const card = cardOf(id);
  return [card.role, ...(brief ? [] : [`## 断法\n\n${card.method}`]), `## 输出要求\n\n${card.output}`].join('\n\n');
}

export function listMethodPrompts(): MethodPrompt[] {
  return METHOD_CARDS.map(card => ({
    name: card.name,
    title: card.title,
    description: card.description,
    arguments: [{ name: 'question', description: METHOD_PROMPT_QUESTION, required: false }],
  }));
}

/** One user message: the card, the shared reading principles and tool conventions, then the question. */
export function renderMethodPrompt(name: string, question?: string): MethodPromptResult {
  const card = CARDS.get(name);
  if (!card) throw new Error(`未知的方法卡：${name}`);
  const asked = question?.trim();
  const text = [
    `以下是太卜「${card.title}」方法卡。请按卡中的断法与工具流程处理我的问题：盘面一律用太卜工具计算，不凭记忆推算干支、卦象、星曜。`,
    renderMethodGuide(card.name).trimEnd(),
    `## 解读通则\n\n${METHOD_PRINCIPLES}`,
    `## 工具约定\n\n${METHOD_CONVENTIONS}`,
    asked ? `我的问题：\n\n${asked}` : '请先问我要问的事，并补齐方法卡需要的资料，再按流程计算与解读。',
  ].join('\n\n');
  return { description: card.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}
