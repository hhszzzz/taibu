/**
 * 干支关系判定引擎：对任意多柱（原局、大运、小运、流年、流月、流日）枚举
 * 天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，只陈述事实。
 *
 * 两种口径：
 * - 同层（不传 focus）：所有柱两两成对，合局/三刑按全体出现判断，与原局
 *   `analyzePillarRelations` 及天干五合/冲、半合、三会分析器一致。
 * - 焦点（传 focus）：只列至少涉及一个焦点柱的关系；合局/三刑以焦点柱为起点，
 *   与其余柱组合，与大运 `calculateBranchRelations` 一致。
 *
 * 不计算拱合、暗合、半会；半合在第三支出现于任一柱时不报（已成三合）。
 */

import {
  BAN_HE_PAIRS,
  LIU_CHONG,
  LIU_HE,
  LIU_HE_HUA,
  SAN_HE,
  SAN_HUI,
  TIAN_GAN_CHONG_KE,
  TIAN_GAN_WU_HE_RESULT,
  XIANG_HAI,
  XIANG_PO,
  XIANG_XING,
} from '../../data/shensha.js';

export type GanzhiLayer = '原局' | '大运' | '小运' | '流年' | '流月' | '流日';

export interface GanzhiPillar {
  /** 柱名，如「年柱」「大运」「流年」 */
  label: string;
  layer: GanzhiLayer;
  stem: string;
  branch: string;
}

export const GANZHI_RELATION_TYPES = [
  '天干五合', '天干相冲', '六合', '三合', '半合', '三会', '六冲', '相刑', '相害', '相破',
] as const;
export type GanzhiRelationType = typeof GANZHI_RELATION_TYPES[number];

export interface GanzhiRelationParticipant {
  /** 在输入数组中的下标 */
  index: number;
  label: string;
  layer: GanzhiLayer;
  part: '天干' | '地支';
  char: string;
}

export interface GanzhiRelationFact {
  type: GanzhiRelationType;
  participants: GanzhiRelationParticipant[];
  /** 合化/成局五行，或三刑名 */
  result?: string;
  description: string;
}

export interface GanzhiRelationOptions {
  /** 焦点柱下标；省略时按同层口径枚举全部柱 */
  focus?: readonly number[];
}

type Part = GanzhiRelationParticipant['part'];

function participant(pillars: readonly GanzhiPillar[], index: number, part: Part): GanzhiRelationParticipant {
  const pillar = pillars[index];
  return {
    index,
    label: pillar.label,
    layer: pillar.layer,
    part,
    char: part === '天干' ? pillar.stem : pillar.branch,
  };
}

function isStemClash(a: string, b: string): boolean {
  return TIAN_GAN_CHONG_KE.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function xingName(name: string, chars: readonly string[]): string {
  // 自刑名已含地支；多支刑把实际参与的地支写在前面
  return name.includes('自刑') ? name : `${chars.join('')}${name}`;
}

/** 两柱之间的天干五合/相冲与地支六合、六冲、害、破；刑归组合段统一判断 */
function pairFacts(pillars: readonly GanzhiPillar[], i: number, j: number): GanzhiRelationFact[] {
  const facts: GanzhiRelationFact[] = [];
  const a = pillars[i], b = pillars[j];
  const stems = [participant(pillars, i, '天干'), participant(pillars, j, '天干')];
  const branches = [participant(pillars, i, '地支'), participant(pillars, j, '地支')];

  const heElement = TIAN_GAN_WU_HE_RESULT[`${a.stem}${b.stem}`];
  if (heElement) {
    facts.push({ type: '天干五合', participants: stems, result: heElement, description: `${a.stem}${b.stem}合${heElement}` });
  }
  if (isStemClash(a.stem, b.stem)) {
    facts.push({ type: '天干相冲', participants: stems, description: `${a.stem}${b.stem}相冲` });
  }
  if (LIU_HE[a.branch] === b.branch) {
    const hua = LIU_HE_HUA[a.branch] || '';
    facts.push({
      type: '六合', participants: branches, ...(hua ? { result: hua } : {}),
      description: `${a.branch}${b.branch}六合${hua ? `化${hua}` : ''}`,
    });
  }
  if (LIU_CHONG[a.branch] === b.branch) {
    facts.push({ type: '六冲', participants: branches, description: `${a.branch}${b.branch}相冲` });
  }
  if (XIANG_HAI[a.branch] === b.branch) {
    facts.push({ type: '相害', participants: branches, description: `${a.branch}${b.branch}相害` });
  }
  if (XIANG_PO[a.branch] === b.branch) {
    facts.push({ type: '相破', participants: branches, description: `${a.branch}${b.branch}相破` });
  }
  return facts;
}

/** 同层口径的地支组合关系：三合/三会三支俱全、半合缺第三支、刑按出现判断 */
function peerGroupFacts(pillars: readonly GanzhiPillar[]): GanzhiRelationFact[] {
  const facts: GanzhiRelationFact[] = [];
  const all = pillars.map((p) => p.branch);
  const indicesOf = (members: readonly string[]) => all.flatMap((b, i) => (members.includes(b) ? [i] : []));
  const uniqueIn = (members: readonly string[]) => [...new Set(all.filter((b) => members.includes(b)))];

  for (const sanHe of SAN_HE) {
    const unique = uniqueIn(sanHe.branches);
    if (unique.length === 3) {
      facts.push({
        type: '三合',
        participants: indicesOf(sanHe.branches).map((i) => participant(pillars, i, '地支')),
        result: sanHe.element,
        description: `${unique.join('')}三合${sanHe.element}`,
      });
    }
  }

  const seenBanHe = new Set<string>();
  for (const banHe of BAN_HE_PAIRS) {
    const [x, y] = banHe.pair;
    if (!all.includes(x) || !all.includes(y) || all.includes(banHe.missing)) continue;
    const key = [x, y].sort().join('') + banHe.element;
    if (seenBanHe.has(key)) continue;
    seenBanHe.add(key);
    const indices = [...all.flatMap((b, i) => (b === x ? [i] : [])), ...all.flatMap((b, i) => (b === y ? [i] : []))];
    facts.push({
      type: '半合',
      participants: indices.map((i) => participant(pillars, i, '地支')),
      result: banHe.element,
      description: `${x}${y}半合${banHe.element}局`,
    });
  }

  for (const hui of SAN_HUI) {
    if (uniqueIn(hui.branches).length === 3) {
      facts.push({
        type: '三会',
        participants: indicesOf(hui.branches).map((i) => participant(pillars, i, '地支')),
        result: hui.element,
        description: `${hui.branches.join('')}三会${hui.element}方`,
      });
    }
  }

  for (const xing of XIANG_XING) {
    const indices = indicesOf(xing.combination);
    const qualifies = xing.combination.length === 1 ? indices.length >= 2 : uniqueIn(xing.combination).length >= 2;
    if (!qualifies) continue;
    facts.push({
      type: '相刑',
      participants: indices.map((i) => participant(pillars, i, '地支')),
      result: xing.name,
      description: xingName(xing.name, uniqueIn(xing.combination)),
    });
  }
  return facts;
}

/** 焦点口径的地支组合关系：以焦点柱为起点，与其余柱组合 */
function focusGroupFacts(pillars: readonly GanzhiPillar[], target: number): GanzhiRelationFact[] {
  const facts: GanzhiRelationFact[] = [];
  const branch = pillars[target].branch;
  const others = pillars.map((p, i) => ({ branch: p.branch, i })).filter(({ i }) => i !== target);
  const withTarget = (indices: number[]) => [target, ...indices].map((i) => participant(pillars, i, '地支'));
  const otherIndices = (members: readonly string[]) => others.filter((o) => members.includes(o.branch)).map((o) => o.i);
  const all = pillars.map((p) => p.branch);

  for (const sanHe of SAN_HE) {
    if (!sanHe.branches.includes(branch)) continue;
    const rest = sanHe.branches.filter((b) => b !== branch);
    const indices = otherIndices(rest);
    const unique = [...new Set(indices.map((i) => all[i]))];
    if (unique.length >= 2) {
      facts.push({ type: '三合', participants: withTarget(indices), result: sanHe.element, description: `${branch}${unique.join('')}三合${sanHe.element}` });
    }
  }

  for (const banHe of BAN_HE_PAIRS) {
    if (!banHe.pair.includes(branch) || all.includes(banHe.missing)) continue;
    const partner = banHe.pair[0] === branch ? banHe.pair[1] : banHe.pair[0];
    const indices = otherIndices([partner]);
    if (indices.length === 0) continue;
    facts.push({ type: '半合', participants: withTarget(indices), result: banHe.element, description: `${banHe.pair.join('')}半合${banHe.element}局` });
  }

  for (const hui of SAN_HUI) {
    if (!hui.branches.includes(branch)) continue;
    const indices = otherIndices(hui.branches.filter((b) => b !== branch));
    if (new Set(indices.map((i) => all[i])).size === 2) {
      facts.push({ type: '三会', participants: withTarget(indices), result: hui.element, description: `${hui.branches.join('')}三会${hui.element}方` });
    }
  }

  for (const xing of XIANG_XING) {
    if (!xing.combination.includes(branch)) continue;
    const needed = xing.combination.length === 1 ? [branch] : xing.combination.filter((b) => b !== branch);
    const indices = otherIndices(needed);
    if (indices.length === 0) continue;
    const chars = [branch, ...new Set(indices.map((i) => all[i]))];
    facts.push({ type: '相刑', participants: withTarget(indices), result: xing.name, description: xingName(xing.name, [...new Set(chars)]) });
  }
  return facts;
}

const GROUP_TYPES = new Set<GanzhiRelationType>(['三合', '半合', '三会', '相刑']);

/**
 * 两两关系按参与柱去重；组合关系按「类型 + 结果 + 参与地支 + 焦点柱」去重，
 * 避免大运、流年同为焦点时同一合局各报一次。
 */
function factKey(fact: GanzhiRelationFact, focus: ReadonlySet<number> | null): string {
  const head = `${fact.type}|${fact.result ?? ''}`;
  if (!focus || !GROUP_TYPES.has(fact.type)) {
    return `${head}|${fact.participants.map((p) => `${p.index}${p.part}`).sort().join(',')}`;
  }
  const chars = [...new Set(fact.participants.map((p) => p.char))].sort().join('');
  const anchors = fact.participants.filter((p) => focus.has(p.index)).map((p) => p.index).sort((a, b) => a - b).join(',');
  return `${head}|${chars}|${anchors}`;
}

const TYPE_ORDER = new Map<GanzhiRelationType, number>(GANZHI_RELATION_TYPES.map((type, i) => [type, i]));

/**
 * 枚举多柱之间的干支关系。返回顺序固定：按关系类型（见 GANZHI_RELATION_TYPES），
 * 再按参与柱的输入顺序。
 */
export function analyzeGanzhiRelations(
  pillars: readonly GanzhiPillar[],
  options: GanzhiRelationOptions = {},
): GanzhiRelationFact[] {
  const focus = options.focus ? new Set(options.focus) : null;
  if (focus) {
    for (const index of focus) {
      if (!Number.isInteger(index) || index < 0 || index >= pillars.length) {
        throw new RangeError(`焦点柱下标越界: ${index}`);
      }
    }
  }

  const facts: GanzhiRelationFact[] = [];
  for (let i = 0; i < pillars.length; i++) {
    for (let j = i + 1; j < pillars.length; j++) {
      if (focus && !focus.has(i) && !focus.has(j)) continue;
      facts.push(...pairFacts(pillars, i, j));
    }
  }
  if (focus) {
    for (const target of [...focus].sort((a, b) => a - b)) facts.push(...focusGroupFacts(pillars, target));
  } else {
    facts.push(...peerGroupFacts(pillars));
  }

  const unique = new Map<string, GanzhiRelationFact>();
  for (const fact of facts) {
    const key = factKey(fact, focus);
    if (!unique.has(key)) unique.set(key, fact);
  }
  const firstIndex = (fact: GanzhiRelationFact) => Math.min(...fact.participants.map((p) => p.index));
  return [...unique.values()].sort((a, b) =>
    (TYPE_ORDER.get(a.type)! - TYPE_ORDER.get(b.type)!) || (firstIndex(a) - firstIndex(b)));
}
