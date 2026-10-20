import { withRulesJSON } from '../../shared/calculation-rules.js';
import { drilldownText } from '../shared/drilldown-render.js';
import type { LiuyaoLineAction, LiuyaoLineFacts, LiuyaoLineOutput, LiuyaoLineRef } from './line.js';

export interface LiuyaoLineCellJSON { 爻位: string; 序号: number; 部位: '本爻' | '伏神' | '变爻'; }

export interface LiuyaoLineActionJSON {
  类型: string;
  位置: LiuyaoLineCellJSON[];
  说明: string;
}

export interface LiuyaoLineJSON {
  爻位: string;
  序号: number;
  六亲: string;
  六神: string;
  纳甲: string;
  五行: string;
  世应?: '世' | '应';
  动静: string;
  旺衰: string;
  旺衰判据: string[];
  特殊状态?: string;
  空亡?: string;
  长生?: string;
  月建作用?: string;
  日辰作用?: string;
  变爻?: { 六亲: string; 纳甲: string; 五行: string; 化变?: string };
  伏神?: { 六亲: string; 纳甲: string; 五行: string; 飞伏关系: string };
  取爻说明?: string;
  受动爻作用: LiuyaoLineActionJSON[];
  动而作用: LiuyaoLineActionJSON[];
  位置: LiuyaoLineCellJSON[];
}

export interface LiuyaoLineCanonicalJSON {
  查询: { 爻位?: number; 角色?: string; 本卦: string; 变卦?: string; 月建: string; 日辰: string };
  爻详情: LiuyaoLineJSON[];
  说明?: string;
  口径: string[];
}

const NOTES = [
  '只列逐爻事实；按 AI-safe 契约不输出用神取用、原神忌神仇神与应期',
  '月建作用、日辰作用取月支、日支对本爻纳甲的生克冲合扶破；旺衰与判据沿用六爻排盘的日月论爻',
  '受动爻作用只列明动、暗动之爻对本爻的生克冲合，不判断作用有力无力；化变取本爻与变爻的回头生克、进退、墓绝空',
  '按六亲取爻而卦中不现时，列其伏神所在的飞神爻',
];

const cell = (item: LiuyaoLineRef): LiuyaoLineCellJSON => ({ 爻位: item.name, 序号: item.position, 部位: item.part });

function actionJSON(action: LiuyaoLineAction): LiuyaoLineActionJSON {
  return {
    类型: action.type,
    位置: [cell(action.from), cell(action.to)],
    说明: `${action.from.name}（${action.from.movement}）${action.from.branch} ${action.type} ${action.to.name} ${action.to.branch}`,
  };
}

function lineJSON(line: LiuyaoLineFacts): LiuyaoLineJSON {
  return {
    爻位: line.ref.name,
    序号: line.ref.position,
    六亲: line.liuQin,
    六神: line.liuShen,
    纳甲: line.naJia,
    五行: line.wuXing,
    ...(line.shiYing ? { 世应: line.shiYing } : {}),
    动静: line.movement,
    旺衰: line.wangShuai,
    旺衰判据: [...line.strengthEvidence],
    ...(line.special ? { 特殊状态: line.special } : {}),
    ...(line.kongWang ? { 空亡: line.kongWang } : {}),
    ...(line.changSheng ? { 长生: line.changSheng } : {}),
    ...(line.monthAction ? { 月建作用: `月${line.monthAction}` } : {}),
    ...(line.dayAction ? { 日辰作用: `日${line.dayAction}` } : {}),
    ...(line.changed ? { 变爻: { 六亲: line.changed.liuQin, 纳甲: line.changed.naJia, 五行: line.changed.wuXing, ...(line.changed.hua ? { 化变: line.changed.hua } : {}) } } : {}),
    ...(line.fuShen ? { 伏神: { 六亲: line.fuShen.liuQin, 纳甲: line.fuShen.naJia, 五行: line.fuShen.wuXing, 飞伏关系: line.fuShen.relation } } : {}),
    ...(line.hiddenOnly ? { 取爻说明: '所查六亲伏于本爻之下' } : {}),
    受动爻作用: line.receivedActions.map(actionJSON),
    动而作用: line.givenActions.map(actionJSON),
    位置: [
      cell(line.ref),
      ...(line.fuShen ? [cell({ ...line.ref, part: '伏神' })] : []),
      ...(line.changed ? [cell({ ...line.ref, part: '变爻' })] : []),
    ],
  };
}

function renderLiuyaoLineJSONBase(result: LiuyaoLineOutput): LiuyaoLineCanonicalJSON {
  return {
    查询: {
      ...(result.query.kind === 'line' ? { 爻位: result.query.line } : { 角色: result.query.role }),
      本卦: result.hexagram.name,
      ...(result.hexagram.changed ? { 变卦: result.hexagram.changed } : {}),
      月建: result.monthBranch,
      日辰: result.dayBranch,
    },
    爻详情: result.lines.map(lineJSON),
    ...(result.note ? { 说明: result.note } : {}),
    口径: NOTES,
  };
}

function actionLines(rows: LiuyaoLineActionJSON[]): string[] {
  return rows.length ? rows.map((row) => `  - ${row.类型}｜${row.位置.map((item) => item.爻位).join('→')}｜${row.说明}`) : ['  - 无'];
}

function renderLiuyaoLineTextBase(result: LiuyaoLineOutput): string {
  const json = renderLiuyaoLineJSONBase(result);
  const query = json.查询;
  const lines = ['# 六爻逐爻详查', '', '## 查询', '',
    `- ${query.爻位 !== undefined ? `第 ${query.爻位} 爻` : `角色：${query.角色}`}`,
    `- 卦：${query.本卦}${query.变卦 ? ` → ${query.变卦}` : ''}`,
    `- 月建：${query.月建}；日辰：${query.日辰}`];
  if (json.说明) lines.push(`- 说明：${json.说明}`);
  lines.push('', '## 爻详情');
  if (!json.爻详情.length) lines.push('', '- 无');
  for (const line of json.爻详情) {
    lines.push('', `### ${line.爻位}${line.世应 ? `（${line.世应}）` : ''}`, '',
      `- ${line.六神}｜${line.六亲} ${line.纳甲}${line.五行}｜${line.动静}`,
      `- 旺衰：${line.旺衰}${line.旺衰判据.length ? `（${line.旺衰判据.join('；')}）` : ''}`);
    const states = [line.特殊状态, line.空亡 && `空亡·${line.空亡}`, line.长生 && `长生·${line.长生}`, line.月建作用, line.日辰作用].filter(Boolean);
    if (states.length) lines.push(`- 状态：${states.join('、')}`);
    if (line.变爻) lines.push(`- 变爻：${line.变爻.六亲} ${line.变爻.纳甲}${line.变爻.五行}${line.变爻.化变 ? `（${line.变爻.化变}）` : ''}`);
    if (line.伏神) lines.push(`- 伏神：${line.伏神.六亲} ${line.伏神.纳甲}${line.伏神.五行}（${line.伏神.飞伏关系}）`);
    if (line.取爻说明) lines.push(`- 取爻：${line.取爻说明}`);
    lines.push('- 受动爻作用：', ...actionLines(line.受动爻作用));
    if (line.动而作用.length) lines.push('- 动而作用：', ...actionLines(line.动而作用));
  }
  return lines.join('\n');
}

export const toLiuyaoLineJson = withRulesJSON(renderLiuyaoLineJSONBase);
export const toLiuyaoLineText = drilldownText(NOTES, renderLiuyaoLineTextBase);
