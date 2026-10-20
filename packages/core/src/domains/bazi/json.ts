import { withRulesJSON } from '../../shared/calculation-rules.js';
import type {
  BaziCanonicalJSON, BaziCellJSON, BaziRelationJSON,
} from './json-types.js';
import type {
  BranchRelationJSON,
  DayunItemJSON,
  HiddenStemJSON,
  LiunianItemJSON,
  TrueSolarTimeJSON
} from '../shared/json-types.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  BaziOutput
} from './types.js';
import { GAN_WUXING, getElementRelation } from '../../shared/utils.js';
import type {
  BaziCanonicalTextOptions
} from '../shared/text-options.js';

function buildTrueSolarTimeJSON(info: {
  clockTime: string; trueSolarTime: string; longitude: number; correctionMinutes: number;
}): TrueSolarTimeJSON {
  return {
    钟表时间: info.clockTime,
    真太阳时: info.trueSolarTime,
    经度: info.longitude,
    校正分钟: info.correctionMinutes,
  };
}

function buildHiddenStemJSON(item: { stem: string; tenGod: string; qiType?: string; }): HiddenStemJSON {
  return {
    天干: item.stem,
    十神: item.tenGod,
    ...(item.qiType ? { 气性: item.qiType } : {}),
  };
}

function buildBranchRelationJSON(item: { type: string; branches: string[]; description: string; }): BranchRelationJSON {
  return {
    类型: item.type,
    地支: [...item.branches],
    描述: item.description,
  };
}

function buildLiunianItemJSON(item: {
  year: number;
  age: number;
  ganZhi: string;
  gan: string;
  zhi: string;
  tenGod: string;
  nayin?: string;
  hiddenStems?: Array<{ stem: string; tenGod: string; qiType?: string; }>;
  diShi?: string;
  shenSha?: string[];
  branchRelations?: Array<{ type: string; branches: string[]; description: string; }>;
  taiSui?: string[];
}): LiunianItemJSON {
  return {
    流年: item.year,
    年龄: item.age,
    干支: item.ganZhi,
    天干: item.gan,
    地支: item.zhi,
    十神: item.tenGod || '-',
    ...(item.nayin ? { 纳音: item.nayin } : {}),
    藏干: item.hiddenStems?.length
      ? item.hiddenStems.map(buildHiddenStemJSON)
      : [],
    ...(item.diShi ? { 地势: item.diShi } : {}),
    ...(item.shenSha?.length ? { 神煞: [...item.shenSha] } : {}),
    ...(item.branchRelations?.length ? { 原局关系: item.branchRelations.map(buildBranchRelationJSON) } : {}),
    ...(item.taiSui?.length ? { 太岁关系: [...item.taiSui] } : {}),
  };
}

function buildLeanHiddenStemItems(items: Array<{ stem: string; tenGod: string; qiType?: string; }> | undefined) {
  return items?.map((item) => ({ stem: item.stem, tenGod: item.tenGod })) || [];
}

function buildDayunItemJSON(item: {
  startYear: number;
  startAge?: number;
  ganZhi: string;
  stem?: string;
  branch?: string;
  tenGod: string;
  branchTenGod?: string;
  hiddenStems?: Array<{ stem: string; tenGod: string; qiType?: string; }>;
  naYin?: string;
  diShi?: string;
  shenSha?: string[];
  branchRelations?: Array<{ type: string; branches: string[]; description: string; }>;
  liunianList?: Array<{
    year: number;
    age: number;
    ganZhi: string;
    gan: string;
    zhi: string;
    tenGod: string;
    nayin?: string;
    hiddenStems?: Array<{ stem: string; tenGod: string; qiType?: string; }>;
    diShi?: string;
    shenSha?: string[];
    branchRelations?: Array<{ type: string; branches: string[]; description: string; }>;
    taiSui?: string[];
  }>;
}): DayunItemJSON {
  return {
    起运年份: item.startYear,
    ...(typeof item.startAge === 'number' ? { 起运年龄: item.startAge } : {}),
    干支: item.ganZhi,
    ...(item.stem ? { 天干: item.stem } : {}),
    ...(item.branch ? { 地支: item.branch } : {}),
    十神: item.tenGod || '-',
    ...(item.branchTenGod ? { 地支主气十神: item.branchTenGod } : {}),
    藏干: item.hiddenStems?.length
      ? item.hiddenStems.map(buildHiddenStemJSON)
      : [],
    ...(item.diShi ? { 地势: item.diShi } : {}),
    ...(item.naYin ? { 纳音: item.naYin } : {}),
    ...(item.shenSha?.length ? { 神煞: [...item.shenSha] } : {}),
    ...(item.branchRelations?.length ? { 原局关系: item.branchRelations.map(buildBranchRelationJSON) } : {}),
    ...(item.liunianList?.length ? { 流年列表: item.liunianList.map(buildLiunianItemJSON) } : {}),
  };
}

function buildBaziCanonicalPillarShenSha(item: { shenSha?: string[]; }): string[] {
  return item.shenSha?.length ? [...item.shenSha] : [];
}

/** 地支关系的说明；刑名不含地支，写出实际参与的地支，如「丑未刑（恃势之刑）」 */
export function baziBranchRelationText(chart: Pick<BaziOutput, 'fourPillars'>, relation: BaziOutput['relations'][number]): string {
  if (relation.type !== '刑') return relation.description;
  const branchOf: Record<string, string> = {
    '年支': chart.fourPillars.year.branch,
    '月支': chart.fourPillars.month.branch,
    '日支': chart.fourPillars.day.branch,
    '时支': chart.fourPillars.hour.branch,
  };
  return `${[...new Set(relation.pillars.map((pillar) => branchOf[pillar]))].join('')}刑（${relation.description}）`;
}

function buildBaziCanonicalRelations(result: Pick<BaziOutput, 'fourPillars' | 'relations' | 'tianGanChongKe' | 'tianGanWuHe' | 'diZhiBanHe' | 'diZhiSanHui'>): string[] {
  const relationParts: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    relationParts.push(value);
  };

  for (const relation of result.relations) pushUnique(baziBranchRelationText(result, relation));
  for (const item of result.tianGanChongKe) {
    pushUnique(`${item.stemA}${item.stemB}冲克`);
  }
  for (const item of result.tianGanWuHe) {
    pushUnique(`${item.stemA}${item.stemB}合${item.resultElement}`);
  }
  for (const item of result.diZhiBanHe) {
    pushUnique(`${item.branches.join('')}半合${item.resultElement}`);
  }
  for (const item of result.diZhiSanHui) {
    pushUnique(`${item.branches.join('')}三会${item.resultElement}`);
  }

  return relationParts;
}

// ===== 八字 =====

export const renderBaziCanonicalJSON = withRulesJSON(renderBaziCanonicalJSONBase);

/** Preserve the positions computed by Core, including repeated stems/branches. */
function buildRelationCoordinates(chart: BaziOutput): BaziRelationJSON[] {
  const pillars = [chart.fourPillars.year, chart.fourPillars.month, chart.fourPillars.day, chart.fourPillars.hour];
  const names = ['年柱', '月柱', '日柱', '时柱'] as const;
  const branchPositions = ['年支', '月支', '日支', '时支'];
  const stemPositions = ['年干', '月干', '日干', '时干'];
  const cell = (position: string, part: BaziCellJSON['部位']): BaziCellJSON | null => {
    const index = (part === '天干' ? stemPositions : branchPositions).indexOf(position);
    if (index < 0) return null;
    const char = part === '天干' ? pillars[index].stem : pillars[index].branch;
    return char && char !== '*' ? { 柱: names[index], 部位: part, 字: char } : null;
  };
  const result: BaziRelationJSON[] = [];
  const add = (type: string, description: string, cells: Array<BaziCellJSON | null>) => {
    if (cells.length < 2 || cells.some(item => item === null)) return;
    result.push({ id: 'bazi-relation-' + result.length, 类型: type, 说明: description, 位置: cells as BaziCellJSON[] });
  };
  for (const relation of chart.relations) add(relation.type, baziBranchRelationText(chart, relation), relation.pillars?.map(position => cell(position, '地支')) ?? []);
  for (const relation of chart.tianGanWuHe) add('合', relation.stemA + relation.stemB + '合' + relation.resultElement, relation.positions?.map(position => cell(position, '天干')) ?? []);
  for (const relation of chart.tianGanChongKe) add('冲克', relation.stemA + relation.stemB + '冲克', relation.positions?.map(position => cell(position, '天干')) ?? []);
  for (const relation of chart.diZhiBanHe) add('半合', relation.branches.join('') + '半合' + relation.resultElement, relation.positions?.map(position => cell(position, '地支')) ?? []);
  for (const relation of chart.diZhiSanHui) add('三会', relation.branches.join('') + '三会' + relation.resultElement, relation.positions?.map(position => cell(position, '地支')) ?? []);
  for (let i = 0; i < pillars.length; i++) for (let j = i + 1; j < pillars.length; j++) {
    const fromElement = GAN_WUXING[pillars[i].stem], toElement = GAN_WUXING[pillars[j].stem];
    if (!fromElement || !toElement) continue;
    const relation = getElementRelation(fromElement, toElement);
    if (relation === 'same') continue;
    const reversed = relation === 'produced' || relation === 'controlled';
    const type = relation === 'produce' || relation === 'produced' ? '生' : '克';
    const from = reversed ? j : i, to = reversed ? i : j;
    add(type, names[from] + pillars[from].stem + type + names[to] + pillars[to].stem, [cell(stemPositions[from], '天干'), cell(stemPositions[to], '天干')]);
  }
  return result;
}

function renderBaziCanonicalJSONBase(
  chart: BaziOutput,
  options: BaziCanonicalTextOptions = {},
): BaziCanonicalJSON {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const { dayun } = options;
  const basicInfo: BaziCanonicalJSON['基本信息'] = {
    性别: chart.gender === 'male' ? '男' : '女',
    日主: chart.dayMaster,
    ...(detailLevel === 'full' ? { 命主五行: `${chart.dayMaster}${GAN_WUXING[chart.dayMaster.charAt(0)] || ''}` } : {}),
  };
  if (detailLevel === 'full' && chart.kongWang?.kongZhi?.length) basicInfo.空亡 = [...chart.kongWang.kongZhi];
  if (chart.birthPlace) basicInfo.出生地 = chart.birthPlace;
  if (chart.trueSolarTimeInfo) basicInfo.真太阳时 = buildTrueSolarTimeJSON(chart.trueSolarTimeInfo);
  if (detailLevel === 'full' && chart.taiYuan) basicInfo.胎元 = chart.taiYuan;
  if (detailLevel === 'full' && chart.mingGong) basicInfo.命宫 = chart.mingGong;

  const fourPillars = ([
    ['年柱', chart.fourPillars.year],
    ['月柱', chart.fourPillars.month],
    ['日柱', chart.fourPillars.day],
    ['时柱', chart.fourPillars.hour],
  ] as const).map(([label, pillar]) => {
    const entry: BaziCanonicalJSON['四柱'][number] = {
      柱: label,
      干支: `${pillar.stem}${pillar.branch}`,
      天干十神: pillar.tenGod || '-',
      藏干: pillar.hiddenStems.map((item) => buildHiddenStemJSON({
        stem: item.stem,
        tenGod: item.tenGod || '-',
        ...(detailLevel === 'full' ? { qiType: item.qiType } : {}),
      })),
      地势: pillar.diShi || '-',
      ...(detailLevel === 'full' && pillar.naYin ? { 纳音: pillar.naYin } : {}),
      ...(detailLevel === 'full' && pillar.shenSha?.length ? { 神煞: buildBaziCanonicalPillarShenSha(pillar) } : {}),
    };
    if (pillar.kongWang?.isKong) entry.空亡 = '是';
    return entry;
  });

  const relations = buildBaziCanonicalRelations(chart);

  const json: BaziCanonicalJSON = { 基本信息: basicInfo, 四柱: fourPillars, 干支关系: relations, 干支关系明细: buildRelationCoordinates(chart) };

  if (dayun) {
    json.大运 = {
      起运信息: `${dayun.startAge}岁（${dayun.startAgeDetail}）`,
      大运列表: dayun.list.map((item) => buildDayunItemJSON({
        startYear: item.startYear,
        startAge: item.startAge,
        ganZhi: item.ganZhi,
        stem: detailLevel === 'full' ? item.stem : undefined,
        branch: detailLevel === 'full' ? item.branch : undefined,
        tenGod: item.tenGod,
        branchTenGod: detailLevel === 'full' ? item.branchTenGod : undefined,
        hiddenStems: detailLevel === 'full' ? item.hiddenStems : buildLeanHiddenStemItems(item.hiddenStems),
        diShi: detailLevel === 'full' ? item.diShi : undefined,
        naYin: detailLevel === 'full' ? item.naYin : undefined,
        shenSha: detailLevel === 'full' ? item.shenSha : undefined,
        branchRelations: detailLevel === 'full' ? item.branchRelations : undefined,
        liunianList: detailLevel === 'full' ? item.liunianList : undefined,
      })),
    };
  }

  return json;
}

// ===== 六爻 =====
