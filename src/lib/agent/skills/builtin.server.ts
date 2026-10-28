import 'server-only';
import { METHOD_CHOICE_RULE, METHOD_CONVENTIONS, listAnalysisMethods, type AnalysisMethod } from 'taibu-core/mcp';
import { loadAnalysisMethod } from '../methods.server';
import { AGENT_SKILL_TOOLS } from '../tool-catalog';
import type { SkillRow } from './store.server';

/**
 * 方法就是内置技能：随发布版本一起编译，只读，不出现在管理员或用户的技能列表里。它们与 taibu-core 的同一份方法
 * 同源（skills/taibu-divination/methods），所以方法里写的工具一定与当前 Core 一致；数据库里的技能可以随时改，
 * 方法不能，否则断法会与工具脱节。任务只用一个加载入口（load_skill）和一个目录（taibu_skills）。
 */

/** A skill as a task sees it, whichever side it came from. */
export type SkillEntry = SkillRow & {
  source: 'builtin' | 'platform' | 'user';
  /** A method's parsed card: its semver, kind, system, Core tools and rendered instructions. */
  method?: AnalysisMethod & { whenToUse?: string; instructions?: string };
};

const bytesOf = (text: string) => Buffer.byteLength(text, 'utf8');

const BUILTIN: readonly SkillEntry[] = listAnalysisMethods().map((item) => {
  const method = loadAnalysisMethod(item.id);
  return {
    id: `builtin:${method.id}`,
    owner_id: null,
    name: method.id,
    description: method.description,
    version: 0,
    required_tier: 'free',
    is_enabled: true,
    disable_model_invocation: false,
    sort_order: 0,
    created_at: '',
    updated_at: '',
    bytes: bytesOf(method.instructions),
    files: [],
    source: 'builtin',
    method,
  };
});

const BY_NAME = new Map(BUILTIN.map((entry) => [entry.name, entry]));

/** Every method, in the order the catalogue lists them. */
export function builtinSkills(): readonly SkillEntry[] {
  return BUILTIN;
}

/** A method by its id; undefined for any other name. */
export function findBuiltinSkill(name: string): SkillEntry | undefined {
  return BY_NAME.get(name);
}

/** Names no stored skill may take: a method always keeps its own name. */
export const BUILTIN_SKILL_NAMES: ReadonlySet<string> = new Set(BY_NAME.keys());

/** A method as the model reads it: the card, then the shared reading principles. */
export function builtinSkillContent(name: string): string | undefined {
  return BY_NAME.get(name)?.method?.instructions;
}

/** A stored skill as a task sees it. */
export function storedEntry(row: SkillRow): SkillEntry {
  return { ...row, source: row.owner_id === null ? 'platform' : 'user' };
}

/** How a card is chosen, after its title in a catalogue line; a system's own card needs no note. */
const KIND_NOTES: Readonly<Record<AnalysisMethod['kind'], string>> = {
  system: '',
  school: '流派，用户点名时用',
  technique: '技法，遇到所述情形时与体系方法同用',
};

/**
 * The cards this agent can load: those whose system tools are offered, plus, with `chartless`, those that read no chart
 * (解梦). A technique joins a system card, whose line already lists the tools, so it shows none of its own.
 */
export function renderMethodLines(offered: readonly string[], chartless = true): string | undefined {
  const names = new Set(offered);
  const lines: string[] = [];
  let charted = false;
  for (const { method } of BUILTIN) {
    if (!method) continue;
    const tools = method.tools.filter((tool) => names.has(tool));
    if (method.tools.length ? !tools.length : !chartless) continue;
    if (method.kind !== 'technique' && tools.length) charted = true;
    const notes = [KIND_NOTES[method.kind], tools.length || method.kind === 'technique' ? '' : '无需排盘'].filter(Boolean);
    const label = `- ${method.id}（${[method.title, ...notes].join('，')}）— ${method.description}`;
    lines.push(method.kind === 'technique' || !tools.length ? label : `${label}工具：${tools.join(', ')}`);
  }
  // A cardless chart does not make a directory: without a chart-reading card the agent has nothing to load.
  if (!charted) return undefined;
  return [
    `方法是内置技能，随版本提供且不可编辑。每个体系首次解读前必须先调用 ${AGENT_SKILL_TOOLS.load} 加载对应 id 的方法，并遵守其断法、工具流程与输出要求；短回答也不得跳过，目录不能代替正文。${METHOD_CHOICE_RULE}`,
    ...lines,
    METHOD_CONVENTIONS,
  ].join('\n');
}
