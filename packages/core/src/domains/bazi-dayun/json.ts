import { withRulesJSON } from '../../shared/calculation-rules.js';
import type {
  DayunCanonicalJSON,
} from './json-types.js';
import type {
  BranchRelationJSON,
  DayunItemJSON,
  HiddenStemJSON,
  LiunianItemJSON
} from '../shared/json-types.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import { DAYUN_YEAR_SHIFT_NOTE, type DayunOutput } from './types.js';
import type {
  DayunCanonicalTextOptions
} from '../shared/text-options.js';

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

export const renderDayunCanonicalJSON = withRulesJSON(renderDayunCanonicalJSONBase);

function renderDayunCanonicalJSONBase(result: DayunOutput, options: { detailLevel?: DayunCanonicalTextOptions['detailLevel']; } = {}): DayunCanonicalJSON {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const json: DayunCanonicalJSON = {
    起运信息: {
      起运年龄: result.startAge,
      起运详情: result.startAgeDetail,
      ...(result.startSolar ? { 起运时刻: result.startSolar, 时区: result.calculationOptions?.startSolarTimezone ?? 'Asia/Shanghai' } : {}),
      ...(result.direction ? { 顺逆: result.direction === 'forward' ? '顺行' : '逆行' } : {}),
      ...(result.startRange ? { 最晚起运时刻: result.startRange.latestStartSolar } : {}),
      ...(result.startRange?.yearShift ? { 交运年份: DAYUN_YEAR_SHIFT_NOTE } : {}),
    },
    大运列表: result.list.map((item) => ({ ...buildDayunItemJSON({
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
    }), ...(result.startRange?.yearShift ? { 最晚起运年份: item.startYear + 1, 最晚起运年龄: item.startAge + 1 } : {}) })),
  };

  if (detailLevel === 'full' && result.xiaoYun.length > 0) {
    json.小运 = result.xiaoYun.map((item) => ({
      年龄: item.age,
      干支: item.ganZhi,
      十神: item.tenGod,
    }));
  }

  return json;
}

// ===== 四柱反推 =====
