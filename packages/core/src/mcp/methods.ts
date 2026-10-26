import type { ToolDefinition } from './contract.js';
import { METHOD_CARDS, METHOD_CONVENTIONS, METHOD_PRINCIPLES, METHOD_SYSTEMS } from './methods.generated.js';

/**
 * What a card is to its system: the system's default card, a school that replaces it when the user names the school,
 * or a technique loaded beside the system card when its situation arises (推理时柱 when the birth hour is unknown).
 */
export type MethodCardKind = 'system' | 'school' | 'technique';

/** A method card as written in skills/taibu-divination/methods: who reads, how to judge, which tools in what order, what to write. */
export interface MethodCardSource {
  name: string;
  title: string;
  kind: MethodCardKind;
  /** The first of `systems`; a technique may serve several */
  system: string;
  systems: string[];
  version: string;
  description: string;
  role: string;
  method: string;
  workflow: string;
  output: string;
}

/** A card and the Core tools of its systems, chart first; a method that needs no chart has none. */
export interface AnalysisMethod {
  id: string;
  title: string;
  kind: MethodCardKind;
  system: string;
  systems: string[];
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

/** A type alias rather than an interface, so it stays assignable to an MCP SDK result with an index signature. */
export type MethodPromptResult = {
  description: string;
  messages: [{ role: 'user'; content: { type: 'text'; text: string } }];
};

export { METHOD_CONVENTIONS, METHOD_PRINCIPLES };

export const METHOD_PROMPT_QUESTION = '要问的事或要解的梦，可附出生时间、起卦方式等资料；留空时先询问用户';

const CARDS = new Map(METHOD_CARDS.map(card => [card.name, card]));
const TOOL_SYSTEMS = new Map(Object.entries(METHOD_SYSTEMS).flatMap(([system, tools]) => tools.map(tool => [tool, system] as const)));

function describe(card: MethodCardSource): AnalysisMethod {
  return {
    id: card.name, title: card.title, kind: card.kind, system: card.system, systems: [...card.systems], version: card.version, description: card.description,
    tools: card.systems.flatMap(system => METHOD_SYSTEMS[system] ?? []),
  };
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

/** The card with the shared reading principles and tool conventions: what a model reads before it interprets. */
export function renderMethodCard(id: string): string {
  return [renderMethodGuide(id).trimEnd(), `## 解读通则\n\n${METHOD_PRINCIPLES}`, `## 工具约定\n\n${METHOD_CONVENTIONS}`].join('\n\n');
}

export const METHOD_TOOL_NAME = 'load_analysis_method';

/**
 * The tool through which a model loads a card itself. MCP prompts are for the user to choose; a client that offers
 * the model only tools would otherwise leave it with the chart and no method.
 */
/** How a card is chosen, after its title in a catalogue line; a system's own card needs no note. */
export const METHOD_KIND_NOTES: Readonly<Record<MethodCardKind, string>> = { system: '', school: '流派，用户点名时用', technique: '技法，遇到所述情形时与体系卡同用' };

/** How to choose among the cards, for a model that sees the whole catalogue. */
export const METHOD_CHOICE_RULE = '同一体系有多张卡时按用户点名的流派选，未点名用与体系同名的默认卡；技法卡（如出生时辰未知时的推理时柱）在遇到其所述情形时另行加载，与体系卡同用，不代替体系卡。';

export function getMethodToolDefinition(): ToolDefinition {
  const cards = METHOD_CARDS.map(card => {
    const notes = [METHOD_KIND_NOTES[card.kind], card.systems.some(system => METHOD_SYSTEMS[system]?.length) ? '' : '无需排盘'].filter(Boolean);
    return `${card.name}（${[card.title, ...notes].join('，')}）`;
  });
  return {
    name: METHOD_TOOL_NAME,
    title: '加载方法卡',
    description: '解读太卜结果前加载对应的方法卡：该体系、流派或技法的角色、断法、工具流程与输出要求，附解读通则与工具约定；每个体系首次解读前加载一次。'
      + `id 填方法卡 ID，或填刚调用的太卜工具名（得到该体系的默认卡）；${METHOD_CHOICE_RULE}`
      + `方法卡：${cards.join('、')}。`,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, description: '方法卡 ID 或太卜工具名' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
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
    renderMethodCard(card.name),
    asked ? `我的问题：\n\n${asked}` : '请先问我要问的事，并补齐方法卡需要的资料，再按流程计算与解读。',
  ].join('\n\n');
  return { description: card.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}
