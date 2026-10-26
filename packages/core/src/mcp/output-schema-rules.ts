import { arr, bool, num, obj, str } from './schema-builders.js';
import type { ToolOutputSchema } from './contract.js';

export const calculationRulesSchema = obj({
  timezone: str(), startSolarTimezone: str(), disambiguation: str(), dayBoundary: str(), solarTermBasis: str(), ruleVersion: str(),
  algorithm: str(), yearDivide: str(), horoscopeDivide: str(), ageDivide: str(), dayDivide: str(), fixLeap: bool(),
  mutagens: { type: 'object', additionalProperties: arr(str()) },
  startYear: num(), endYear: num(), precision: str(), excludedAmbiguousMinutes: num(), yunSect: num(), ageConvention: str(),
  year: num(), month: num(), day: num(), hour: num(), minute: num(), panType: str(), juMethod: str(), zhiFuJiGong: str(), flyStarMethod: str(), juNumber: num(), dunType: str(),
  longitude: num(), latitude: num(), monthGeneral: str(), monthGeneralSource: str(), dayNight: str(),
  method: str(), date: str(), yaoValues: arr(num()), distribution: str(),
  deck: str(), reversedProbability: num(), referenceYear: num(),
  seed: str(), hourType: str(), leapMonthStrategy: str(),
  trueSolarTime: obj({ clockTime: str(), trueSolarTime: str(), longitude: num(), correctionMinutes: num(), trueTimeIndex: num(), dayOffset: num(), timezone: str(), utcOffsetMinutes: num(), equationOfTimeMinutes: num(), ruleVersion: str() }),
  zodiac: str(), houseSystem: str(), ephemeris: str(), coordinateFrame: str(), ayanamsa: num(),
  aspectOrbs: obj(Object.fromEntries(['conjunction', 'opposition', 'trine', 'square', 'sextile'].map(type => [type, num()]))),
  系统: str(), 时区: str(), 规则版本: str(), 计法: str(), 积数口径: str(), 积年常数: num(),
});

/** Mandatory default-level sections. Full-only sections remain optional in the single published schema. */
export const requiredOutputSections: Record<string, string[]> = {
  astrology: ['基础坐标', '命盘锚点', '本命主星', '当前流运触发'],
  astrology_point: ['查询', '口径'],
  bazi: ['基本信息', '四柱', '干支关系'],
  bazi_dayun: ['起运信息', '大运列表'],
  bazi_relations: ['查询', '参与柱位', '叠加关系', '口径'],
  // 其余事实组按 sections 选取，默认全部给出
  bazi_wuxing: ['日主', '月令', '缺失五行', '口径'],
  bazi_liunian_scan: ['扫描范围', '原局四柱', '逐年', '口径'],
  bazi_pillars_resolve: ['原始四柱', '候选数量', '候选列表'],
  bazi_hour_candidates: ['出生日期', '共有柱', '候选数量', '候选', '口径'],
  ziwei: ['基本信息', '十二宫位'],
  ziwei_horoscope: ['基本信息', '运限叠宫'],
  ziwei_flying_star: ['查询结果'],
  ziwei_palace: ['查询', '宫位概览', '本宫星曜', '三方四正', '夹宫', '宫干四化飞出', '四化飞入', '口径'],
  liuyao: ['卦盘', '六爻全盘', '全局互动', '元信息'],
  liuyao_line: ['查询', '爻详情', '口径'],
  meihua: ['起卦信息', '卦盘', '干支时间', '体用分析', '阶段推演'],
  tarot: ['问卜设定', '牌阵展开'],
  taiyi: ['问卜与时空底盘', '外部时空环境', '核心物理关系', '九星阵列', '古典参考'],
  almanac: ['基础与个性化坐标', '传统黄历基调', '择日宜忌', '神煞参考'],
  almanac_select: ['查询', '候选日', '排除统计', '口径'],
  bazi_hepan: ['双方', '日主互见', '年命纳音', '日柱之间', '年柱之间', '其余关系', '五行互补', '口径'],
  qimen: ['基本信息', '九宫盘'],
  qimen_palace: ['查询', '宫位', '天地盘', '星门神', '状态', '柱干落宫', '遁甲', '生克', '值符值使', '格局', '口径'],
  daliuren: ['基本信息', '四课', '三传', '天地盘'],
  daliuren_lessons: ['查询', '基础', '口径'],
  xiaoliuren: ['起课信息', '推演链', '结果'],
};

/** Cardinality and identity fields of the canonical board, independent of detail level. */
const boardArrays: Record<string, { path: string[]; size: number; fields: string[] }[]> = {
  bazi: [{ path: ['四柱'], size: 4, fields: ['柱', '干支', '藏干'] }],
  bazi_hepan: [{ path: ['双方'], size: 2, fields: ['称呼', '四柱', '日主', '生肖', '缺失五行'] }],
  ziwei: [{ path: ['十二宫位'], size: 12, fields: ['宫位', '干支', '主星及四化', '辅星'] }],
  liuyao: [{ path: ['六爻全盘', '爻列表'], size: 6, fields: ['爻位', '六神', '本爻'] }],
  qimen: [{ path: ['九宫盘'], size: 9, fields: ['宫名', '九星', '八门', '天盘天干', '地盘天干'] }],
  daliuren: [
    { path: ['四课'], size: 4, fields: ['课别', '乘将', '上神', '下神'] },
    { path: ['三传'], size: 3, fields: ['传序', '地支', '天将', '六亲', '遁干'] },
    { path: ['天地盘'], size: 12, fields: ['地盘', '天盘', '天将', '遁干', '长生十二神'] },
  ],
};

export function completeOutputSchema(name: string, schema: ToolOutputSchema): ToolOutputSchema {
  const result = structuredClone(schema);
  result.properties.计算规则 = calculationRulesSchema;
  result.required = [...new Set([...(result.required ?? requiredOutputSections[name] ?? []), '计算规则'])];
  for (const rule of boardArrays[name] ?? []) {
    let current = result as unknown as Record<string, unknown>;
    for (const key of rule.path) {
      current.required = [...new Set([...(current.required as string[] ?? []), key])];
      current = (current.properties as Record<string, Record<string, unknown>>)[key];
    }
    current.minItems = rule.size;
    current.maxItems = rule.size;
    (current.items as Record<string, unknown>).required = rule.fields;
  }
  if (name === 'bazi') {
    // 出生时辰未知时不排时柱：带「出生时辰」标注的盘只有年、月、日三柱，其余仍须四柱齐全
    (result.properties.四柱 as Record<string, unknown>).minItems = 3;
    Object.assign(result as Record<string, unknown>, {
      if: { properties: { 基本信息: { required: ['出生时辰'] } } },
      then: { properties: { 四柱: { maxItems: 3 } } },
      else: { properties: { 四柱: { minItems: 4 } } },
    });
  }
  if (name === 'tarot') {
    const cards = result.properties.牌阵展开 as Record<string, unknown>;
    cards.minItems = 1;
    cards.maxItems = 78;
    (cards.items as Record<string, unknown>).required = ['位置', '塔罗牌', '状态', '核心基调'];
  }
  return result;
}
