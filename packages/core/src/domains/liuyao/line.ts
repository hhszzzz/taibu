/**
 * 六爻逐爻详查：按爻位或角色（世、应、动爻、六亲）取爻，列纳甲、六亲、六神、
 * 日月作用、旺衰、空破暗动、化变、伏神与动爻生克。遵循 AI-safe 契约：
 * 不输出用神取用、原忌仇神或应期。
 */

import { CoreInputError, assertInteger } from '../../shared/validation.js';
import { mapLiuyaoRelationLabel } from '../../shared/render-utils.js';
import type { DiZhi, FullYaoInfo } from '../shared/types.js';
import {
  ACTION_LABELS,
  KONG_WANG_LABELS,
  MOVEMENT_LABELS,
  SPECIAL_STATUS_LABELS,
  getYaoInfluence,
  getZhiAction,
  traditionalYaoName,
  WANG_SHUAI_LABELS,
} from './calculate.js';
import type { LiuyaoInput, LiuyaoOutput } from './types.js';

export const LIUYAO_LINE_RULE_VERSION = 'liuyao-line-2026.10';
export const LIUYAO_LINE_ROLES = ['世', '应', '动', '父母', '兄弟', '子孙', '妻财', '官鬼'] as const;
export type LiuyaoLineRole = typeof LIUYAO_LINE_ROLES[number];

export interface LiuyaoLineSelector {
  line?: number;
  role?: LiuyaoLineRole;
}

export interface LiuyaoLineRef {
  position: number;
  name: string;
  part: '本爻' | '伏神' | '变爻';
}

export interface LiuyaoLineAction {
  /** 生、克、扶、冲、合、相破 */
  type: string;
  from: LiuyaoLineRef & { branch: string; movement: string };
  to: LiuyaoLineRef & { branch: string };
}

export interface LiuyaoLineFacts {
  ref: LiuyaoLineRef;
  /** 按六亲取爻时，该六亲只在伏神中出现 */
  hiddenOnly: boolean;
  liuQin: string;
  liuShen: string;
  naJia: string;
  wuXing: string;
  shiYing?: '世' | '应';
  movement: string;
  wangShuai: string;
  strengthEvidence: string[];
  special?: string;
  kongWang?: string;
  changSheng?: string;
  monthAction?: string;
  dayAction?: string;
  changed?: { liuQin: string; naJia: string; wuXing: string; hua?: string };
  fuShen?: { liuQin: string; naJia: string; wuXing: string; relation: string };
  receivedActions: LiuyaoLineAction[];
  givenActions: LiuyaoLineAction[];
}

export interface LiuyaoLineOutput {
  query: { kind: 'line'; line: number } | { kind: 'role'; role: LiuyaoLineRole };
  hexagram: { name: string; changed?: string };
  monthBranch: string;
  dayBranch: string;
  lines: LiuyaoLineFacts[];
  note?: string;
  seed?: string;
  calculationOptions: Record<string, unknown> & { ruleVersion: string };
}

const isActing = (yao: FullYaoInfo) => yao.isChanging || yao.movementState === 'hidden_moving';
const nameOf = (yao: FullYaoInfo) => traditionalYaoName(yao.position, yao.type);
const ref = (yao: FullYaoInfo, part: LiuyaoLineRef['part'] = '本爻'): LiuyaoLineRef => ({ position: yao.position, name: nameOf(yao), part });

function actionOf(source: FullYaoInfo, target: FullYaoInfo): LiuyaoLineAction | null {
  const type = getZhiAction(source.naJia as DiZhi, target.naJia as DiZhi);
  if (type === 'none') return null;
  return {
    type: ACTION_LABELS[type],
    from: { ...ref(source), branch: source.naJia, movement: MOVEMENT_LABELS[source.movementState] ?? source.movementLabel },
    to: { ...ref(target), branch: target.naJia },
  };
}

function factsOf(yao: FullYaoInfo, all: FullYaoInfo[], monthBranch: string, dayBranch: string, hiddenOnly: boolean): LiuyaoLineFacts {
  const influence = getYaoInfluence(yao.naJia as DiZhi, monthBranch as DiZhi, dayBranch as DiZhi);
  const special = SPECIAL_STATUS_LABELS[yao.strength.specialStatus];
  const kong = yao.kongWangState && yao.kongWangState !== 'not_kong' ? KONG_WANG_LABELS[yao.kongWangState] : '';
  const others = all.filter((item) => item.position !== yao.position);
  return {
    ref: ref(yao),
    hiddenOnly,
    liuQin: yao.liuQin,
    liuShen: yao.liuShen,
    naJia: yao.naJia,
    wuXing: yao.wuXing,
    ...(yao.isShiYao ? { shiYing: '世' as const } : yao.isYingYao ? { shiYing: '应' as const } : {}),
    movement: yao.movementLabel,
    wangShuai: WANG_SHUAI_LABELS[yao.strength.wangShuai],
    strengthEvidence: [...yao.strength.evidence],
    ...(special ? { special } : {}),
    ...(kong ? { kongWang: kong } : {}),
    ...(yao.changSheng?.stage ? { changSheng: yao.changSheng.stage } : {}),
    ...(influence.monthAction !== 'none' ? { monthAction: ACTION_LABELS[influence.monthAction] } : {}),
    ...(influence.dayAction !== 'none' ? { dayAction: ACTION_LABELS[influence.dayAction] } : {}),
    ...(yao.changedYao ? {
      changed: {
        liuQin: yao.changedYao.liuQin,
        naJia: yao.changedYao.naJia,
        wuXing: yao.changedYao.wuXing,
        ...(mapLiuyaoRelationLabel(yao.changedYao.relation) ? { hua: mapLiuyaoRelationLabel(yao.changedYao.relation) } : {}),
      },
    } : {}),
    ...(yao.fuShen ? { fuShen: { liuQin: yao.fuShen.liuQin, naJia: yao.fuShen.naJia, wuXing: yao.fuShen.wuXing, relation: yao.fuShen.relation } } : {}),
    receivedActions: others.filter(isActing).flatMap((source) => actionOf(source, yao) ?? []),
    givenActions: isActing(yao) ? others.flatMap((target) => actionOf(yao, target) ?? []) : [],
  };
}

export function deriveLiuyaoLine(chart: LiuyaoOutput, selector: LiuyaoLineSelector, _baseInput: LiuyaoInput): LiuyaoLineOutput {
  const hasLine = selector.line !== undefined, hasRole = selector.role !== undefined;
  if (hasLine === hasRole) throw new CoreInputError(hasLine ? 'role' : 'line', 'line 与 role 必须且只能给出一个');
  const all = [...(chart.fullYaos ?? [])].sort((a, b) => a.position - b.position);
  const monthBranch = chart.ganZhiTime.month.zhi, dayBranch = chart.ganZhiTime.day.zhi;
  let picked: Array<{ yao: FullYaoInfo; hiddenOnly: boolean }> = [];
  let note: string | undefined;
  if (hasLine) {
    assertInteger(selector.line, 'line', 1, 6);
    picked = all.filter((yao) => yao.position === selector.line).map((yao) => ({ yao, hiddenOnly: false }));
  } else {
    const role = selector.role!;
    if (!(LIUYAO_LINE_ROLES as readonly string[]).includes(role)) throw new CoreInputError('role', `未知角色: ${role}`);
    const visible = all.filter((yao) => role === '世' ? yao.isShiYao : role === '应' ? yao.isYingYao : role === '动' ? yao.isChanging : yao.liuQin === role);
    picked = visible.map((yao) => ({ yao, hiddenOnly: false }));
    if (!picked.length && role === '动') note = '静卦，没有明动之爻';
    if (!picked.length && !['世', '应', '动'].includes(role)) {
      picked = all.filter((yao) => yao.fuShen?.liuQin === role).map((yao) => ({ yao, hiddenOnly: true }));
      note = picked.length ? `${role}不上卦，伏于下列飞神之下` : `${role}既不上卦也无伏神`;
    }
  }
  return {
    query: hasLine ? { kind: 'line', line: selector.line! } : { kind: 'role', role: selector.role! },
    hexagram: { name: chart.hexagramName, ...(chart.changedHexagramName ? { changed: chart.changedHexagramName } : {}) },
    monthBranch,
    dayBranch,
    lines: picked.map(({ yao, hiddenOnly }) => factsOf(yao, all, monthBranch, dayBranch, hiddenOnly)),
    ...(note ? { note } : {}),
    ...(chart.seed ? { seed: chart.seed } : {}),
    calculationOptions: { ...(chart.calculationOptions ?? {}), ruleVersion: LIUYAO_LINE_RULE_VERSION },
  };
}
