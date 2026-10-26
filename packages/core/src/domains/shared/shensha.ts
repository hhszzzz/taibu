export type ShenShaPillarPosition = 'year' | 'month' | 'day' | 'hour';

export interface ShenShaContext {
  yearStem: string;
  yearBranch: string;
  monthStem: string;
  monthBranch: string;
  dayStem: string;
  dayBranch: string;
  /** 八字出生时辰未知时没有时柱 */
  hourStem?: string;
  hourBranch?: string;
  kongWang?: { xun: string; kongZhi: [string, string]; };
  yearNaYinElement?: string; // 年柱纳音五行（金/木/水/火/土），用于学堂查表
}

export interface PillarShenShaByPosition {
  year: string[];
  month: string[];
  day: string[];
  hour?: string[];
}

// 从数据模块导入
import {
  BA_ZHUAN,
  BAI_HU,
  CI_GUAN,
  DIAO_KE,
  FEI_REN,
  FU_XING,
  GOU_SHA,
  GU_CHEN,
  GU_LUAN,
  GUA_SU,
  GUO_YIN,
  HONG_LUAN,
  HONG_YAN,
  HUA_GAI,
  JIANG_XING,
  JIAO_SHA,
  JIE_SHA,
  JIN_SHEN,
  KUI_GANG,
  LIU_XIA,
  LU_SHEN,
  PI_TOU,
  SAN_QI,
  SANG_MEN,
  SHI_E_DA_BAI,
  SI_FEI_RI,
  TAI_JI_GUI_REN,
  TAO_HUA,
  TIAN_CHU,
  TIAN_XI,
  TIAN_YI,
  TIAN_YI_GUI_REN,
  WANG_SHEN,
  WEN_CHANG,
  XUE_REN,
  XUE_TANG,
  YANG_REN,
  YI_MA,
  YIN_CHA_YANG_CUO,
  ZAI_SHA,
} from '../../data/shensha.js';

function addUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function checkDayPillarShenSha(
  dayStem: string,
  dayBranch: string,
  monthBranch: string,
  names: string[],
  options?: { includeFull?: boolean; },
): void {
  const dayPillar = `${dayStem}${dayBranch}`;
  if (KUI_GANG.includes(dayPillar)) addUnique(names, '魁罡');
  if (YIN_CHA_YANG_CUO.includes(dayPillar)) addUnique(names, '阴差阳错');
  if (SHI_E_DA_BAI.includes(dayPillar)) addUnique(names, '十恶大败');
  if (options?.includeFull) {
    if (BA_ZHUAN.includes(dayPillar)) addUnique(names, '八专');
    if (JIN_SHEN.includes(dayPillar)) addUnique(names, '金神');
    if (GU_LUAN.includes(dayPillar)) addUnique(names, '孤鸾煞');
    const siFeiList = SI_FEI_RI[monthBranch];
    if (siFeiList && siFeiList.includes(dayPillar)) addUnique(names, '四废');
  }
}

function matchValue(values: string[] | undefined, targetBranch: string, label: string, bag: string[]): void {
  if (values && values.includes(targetBranch)) {
    addUnique(bag, label);
  }
}

function matchMapValue(map: Record<string, string>, key: string, targetBranch: string, label: string, bag: string[]): void {
  if (map[key] && map[key] === targetBranch) {
    addUnique(bag, label);
  }
}

export function calculateBranchShenSha(
  context: ShenShaContext,
  targetBranch: string,
  options?: { positionHint?: ShenShaPillarPosition; }
): string[] {
  const { yearStem, yearBranch, monthBranch, dayStem, dayBranch, hourBranch, kongWang } = context;
  const positionHint = options?.positionHint;
  const names: string[] = [];

  matchValue(TIAN_YI_GUI_REN[dayStem], targetBranch, '天乙贵人', names);
  matchValue(TAI_JI_GUI_REN[dayStem], targetBranch, '太极贵人', names);
  matchValue(TAI_JI_GUI_REN[yearStem], targetBranch, '太极贵人', names);
  matchMapValue(LU_SHEN, dayStem, targetBranch, '禄神', names);
  matchMapValue(YANG_REN, dayStem, targetBranch, '羊刃', names);
  matchMapValue(WEN_CHANG, dayStem, targetBranch, '文昌', names);
  matchMapValue(TIAN_CHU, dayStem, targetBranch, '天厨', names);
  matchMapValue(GUO_YIN, dayStem, targetBranch, '国印贵人', names);
  matchMapValue(FU_XING, dayStem, targetBranch, '福星贵人', names);
  matchMapValue(LIU_XIA, dayStem, targetBranch, '流霞', names);
  matchMapValue(HONG_YAN, dayStem, targetBranch, '红艳煞', names);
  matchMapValue(FEI_REN, dayStem, targetBranch, '飞刃', names);
  matchMapValue(CI_GUAN, dayStem, targetBranch, '词馆', names);

  // 三合局（年/日支）→地支
  matchMapValue(YI_MA, dayBranch, targetBranch, '驿马', names);
  if (YI_MA[yearBranch] === targetBranch && !names.includes('驿马')) addUnique(names, '驿马');
  matchMapValue(TAO_HUA, dayBranch, targetBranch, '桃花', names);
  if (TAO_HUA[yearBranch] === targetBranch && !names.includes('桃花')) addUnique(names, '桃花');
  matchMapValue(HUA_GAI, dayBranch, targetBranch, '华盖', names);
  if (HUA_GAI[yearBranch] === targetBranch && !names.includes('华盖')) addUnique(names, '华盖');
  matchMapValue(JIANG_XING, dayBranch, targetBranch, '将星', names);
  if (JIANG_XING[yearBranch] === targetBranch && !names.includes('将星')) addUnique(names, '将星');
  matchMapValue(JIE_SHA, dayBranch, targetBranch, '劫煞', names);
  if (JIE_SHA[yearBranch] === targetBranch && !names.includes('劫煞')) addUnique(names, '劫煞');
  matchMapValue(WANG_SHEN, dayBranch, targetBranch, '亡神', names);
  if (WANG_SHEN[yearBranch] === targetBranch && !names.includes('亡神')) addUnique(names, '亡神');
  matchMapValue(ZAI_SHA, dayBranch, targetBranch, '灾煞', names);
  if (ZAI_SHA[yearBranch] === targetBranch && !names.includes('灾煞')) addUnique(names, '灾煞');

  // 年支→地支
  // 学堂：以年柱纳音五行查表
  if (context.yearNaYinElement) {
    matchMapValue(XUE_TANG, context.yearNaYinElement, targetBranch, '学堂', names);
  }
  matchMapValue(HONG_LUAN, yearBranch, targetBranch, '红鸾', names);
  matchMapValue(TIAN_XI, yearBranch, targetBranch, '天喜', names);
  matchMapValue(DIAO_KE, yearBranch, targetBranch, '吊客', names);
  matchMapValue(SANG_MEN, yearBranch, targetBranch, '丧门', names);
  matchMapValue(PI_TOU, yearBranch, targetBranch, '披头', names);
  matchMapValue(GOU_SHA, yearBranch, targetBranch, '勾煞', names);
  matchMapValue(JIAO_SHA, yearBranch, targetBranch, '绞煞', names);

  // 月支→干支
  matchMapValue(TIAN_YI, monthBranch, targetBranch, '天医', names);
  matchMapValue(BAI_HU, monthBranch, targetBranch, '白虎', names);

  // 日支→地支
  matchMapValue(XUE_REN, dayBranch, targetBranch, '血刃', names);

  if (GU_CHEN[yearBranch] === targetBranch) addUnique(names, '孤辰');
  if (GUA_SU[yearBranch] === targetBranch) addUnique(names, '寡宿');

  if (kongWang?.kongZhi?.includes(targetBranch)) {
    addUnique(names, '空亡');
  }

  // 天罗地网：戌亥=天罗, 辰巳=地网
  // 当前柱位的地支是戌或亥时，且四柱中存在配对（戌↔亥），标记天罗
  // 当前柱位的地支是辰或巳时，且四柱中存在配对（辰↔巳），标记地网
  if (positionHint) {
    const allBranches = [yearBranch, monthBranch, dayBranch, hourBranch];
    if (targetBranch === '戌' && allBranches.includes('亥')) addUnique(names, '天罗');
    if (targetBranch === '亥' && allBranches.includes('戌')) addUnique(names, '天罗');
    if (targetBranch === '辰' && allBranches.includes('巳')) addUnique(names, '地网');
    if (targetBranch === '巳' && allBranches.includes('辰')) addUnique(names, '地网');
  }

  if (positionHint === 'day') {
    checkDayPillarShenSha(dayStem, dayBranch, monthBranch, names, { includeFull: true });
  }

  // 三奇（检查三柱天干连续出现）
  if (positionHint) {
    const stems = [context.yearStem, context.monthStem, context.dayStem, context.hourStem];
    for (const [qiName, qiStems] of Object.entries(SAN_QI)) {
      for (let i = 0; i <= stems.length - 3; i++) {
        if (stems[i] === qiStems[0] && stems[i + 1] === qiStems[1] && stems[i + 2] === qiStems[2]) {
          const positions: ShenShaPillarPosition[] = ['year', 'month', 'day', 'hour'];
          if (positionHint === positions[i] || positionHint === positions[i + 1] || positionHint === positions[i + 2]) {
            addUnique(names, qiName);
          }
          break;
        }
      }
    }
  }

  // 位置无关场景（如六爻逐爻）给出轻量全局命中提示
  if (!positionHint) {
    checkDayPillarShenSha(dayStem, dayBranch, monthBranch, names);
  }

  return names;
}

export function calculateGlobalShenSha(context: ShenShaContext): string[] {
  const result: string[] = [];

  checkDayPillarShenSha(context.dayStem, context.dayBranch, context.monthBranch, result, { includeFull: true });

  const allBranches = [context.yearBranch, context.monthBranch, context.dayBranch, context.hourBranch];
  if ((allBranches.includes('戌') && allBranches.includes('亥'))) {
    addUnique(result, '天罗');
  }
  if ((allBranches.includes('辰') && allBranches.includes('巳'))) {
    addUnique(result, '地网');
  }

  // 三奇
  const stems = [context.yearStem, context.monthStem, context.dayStem, context.hourStem];
  for (const [qiName, qiStems] of Object.entries(SAN_QI)) {
    for (let i = 0; i <= stems.length - 3; i++) {
      if (stems[i] === qiStems[0] && stems[i + 1] === qiStems[1] && stems[i + 2] === qiStems[2]) {
        addUnique(result, qiName);
        break;
      }
    }
  }

  return result;
}

export function calculatePillarShenSha(context: ShenShaContext): PillarShenShaByPosition {
  return {
    year: calculateBranchShenSha(context, context.yearBranch, { positionHint: 'year' }),
    month: calculateBranchShenSha(context, context.monthBranch, { positionHint: 'month' }),
    day: calculateBranchShenSha(context, context.dayBranch, { positionHint: 'day' }),
    ...(context.hourBranch === undefined ? {} : { hour: calculateBranchShenSha(context, context.hourBranch, { positionHint: 'hour' }) }),
  };
}
