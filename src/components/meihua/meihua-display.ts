/**
 * 梅花展示层纯函数：只拆解 canonical JSON 里已有的关系表达式与卦名，不参与起卦计算。
 */

export type MeihuaRelationVerb = '生' | '克' | '比和';

export interface MeihuaRelation {
  fromLabel: string;
  /** 卦名 + 五行，如「乾金」「变卦(艮土)」中的「艮土」；旧版结果的变卦整卦为「火风鼎/火」。 */
  from: string;
  verb: MeihuaRelationVerb;
  toLabel: string;
  to: string;
}

export interface MeihuaStageRow {
  /** 无法识别的表达式为 null，界面回退为原文。 */
  relation: MeihuaRelation | null;
  text: string;
  /** 关系说明，如「用卦克体卦」「体互、用互皆乾金克体」；无法识别时为空。 */
  description: string;
}

const DIRECTED_RELATION = /^(.+?)\((.+?)\) (生|克) (.+?)\((.+?)\)$/u;
const BALANCED_RELATION = /^(.+?)\((.+?)\) 与 (.+?)\((.+?)\) 比和$/u;
const PURE_HEXAGRAM = /^.为.$/u;

/** 解析 core 的关系表达式「用卦(乾金) 克 体卦(巽木)」「体卦(巽木) 与 体互(震木) 比和」。 */
export function parseMeihuaRelation(expression: string): MeihuaRelation | null {
  const text = expression.trim();
  const directed = DIRECTED_RELATION.exec(text);
  if (directed) {
    return { fromLabel: directed[1], from: directed[2], verb: directed[3] as MeihuaRelationVerb, toLabel: directed[4], to: directed[5] };
  }
  const balanced = BALANCED_RELATION.exec(text);
  if (balanced) return { fromLabel: balanced[1], from: balanced[2], verb: '比和', toLabel: balanced[3], to: balanced[4] };
  return null;
}

function describeRelation(relation: MeihuaRelation): string {
  return relation.verb === '比和'
    ? `${relation.fromLabel}与${relation.toLabel}比和`
    : `${relation.fromLabel}${relation.verb}${relation.toLabel}`;
}

/** 体互与用互对体卦的作用完全相同（同一卦象、同一生克）时合并为一行；否则返回 null。 */
function mergeIdenticalRelations(relations: MeihuaRelation[], text: string): MeihuaStageRow | null {
  const [first, ...rest] = relations;
  if (!first || rest.length === 0) return null;
  if (!rest.every((item) => item.from === first.from && item.verb === first.verb && item.to === first.to)) return null;
  const sameFrom = rest.every((item) => item.fromLabel === first.fromLabel);
  const sameTo = rest.every((item) => item.toLabel === first.toLabel);
  if (sameFrom && sameTo) return { relation: first, text, description: describeRelation(first) };
  if (sameFrom === sameTo) return null;

  if (sameTo) {
    // 「体互(乾金) 克 体卦(巽木)；用互(乾金) 克 体卦(巽木)」→「体互、用互皆乾金克体」
    const labels = relations.map((item) => item.fromLabel).join('、');
    return { relation: first, text, description: `${labels}皆${first.from}${first.verb}${first.toLabel.replace(/卦$/u, '')}` };
  }
  // 体卦在前：「体卦生体互、用互」「体卦与体互、用互比和」
  const labels = relations.map((item) => item.toLabel).join('、');
  const description = first.verb === '比和' ? `${first.fromLabel}与${labels}比和` : `${first.fromLabel}${first.verb}${labels}`;
  return { relation: first, text, description };
}

/** 阶段表达式（多条以「；」分隔）→ 体用推演的展示行。 */
export function buildMeihuaStageRows(expression: string): MeihuaStageRow[] {
  const parts = expression.split('；').map((part) => part.trim()).filter(Boolean);
  const relations = parts.map(parseMeihuaRelation);
  if (relations.every((item): item is MeihuaRelation => item !== null)) {
    const merged = mergeIdenticalRelations(relations, parts.join('；'));
    if (merged) return [merged];
  }
  return parts.map((text, index) => {
    const relation = relations[index];
    return { relation, text, description: relation ? describeRelation(relation) : '' };
  });
}

/** 六十四卦简称：纯卦「乾为天」取首字，其余去掉上下卦象两字，如「火风鼎」→「鼎」、「水火既济」→「既济」。 */
export function shortHexagramName(name: string): string {
  if (PURE_HEXAGRAM.test(name)) return name.charAt(0);
  return name.length > 2 ? name.slice(2) : name;
}

/** 关系两端的展示文字：卦名五行原样返回，旧版结果的变卦整卦「火风鼎/火」→「鼎 · 火」。 */
export function formatRelationTerm(term: string): string {
  const [name, element] = term.split('/');
  return element ? `${shortHexagramName(name)} · ${element}` : term;
}
