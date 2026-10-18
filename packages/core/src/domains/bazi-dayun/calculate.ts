/**
 * 大运计算核心引擎
 * 根据出生时间计算完整大运列表，包括：
 * - 大运与原局地支关系
 * - 流年干支及十神、纳音
 * - 流年与原局/大运关系
 * - 关键年份标注（太岁关系）
 * - 小运排列
 */

import {
  LIU_CHONG,
  LIU_HE,
  NA_YIN_TABLE,
  SAN_HE,
  XIANG_HAI,
  XIANG_PO,
  XIANG_XING,
} from '../../data/shensha.js';
import { calculateBranchShenSha, type ShenShaContext } from '../shared/shensha.js';
import type { DayunInput, DayunOutput } from './types.js';
import type { BranchRelation, LiunianInfo, XiaoyunInfo } from '../shared/types.js';
import { calculateTenGod, DI_ZHI, getStemYinYang, TIAN_GAN } from '../../shared/utils.js';
import { buildHiddenStems, getDiShi, getNaYin, resolveBaziCalendarContext } from '../bazi/calculate.js';
import { CoreInputError } from '../../shared/validation.js';
import { CALENDAR_TIMEZONE, DEFAULT_DIVINATION_TIMEZONE } from '../../shared/timezone-utils.js';

export type { DayunInput, DayunOutput } from './types.js';
export type { LiunianInfo, XiaoyunInfo } from '../shared/types.js';

const HIDDEN_STEM_MAIN: Record<string, string> = {
  '子': '癸', '丑': '己', '寅': '甲', '卯': '乙',
  '辰': '戊', '巳': '丙', '午': '丁', '未': '己',
  '申': '庚', '酉': '辛', '戌': '戊', '亥': '壬',
};

// 六十甲子顺序表
const JIA_ZI_60: string[] = (() => {
  const result: string[] = [];
  for (let i = 0; i < 60; i++) {
    result.push(`${TIAN_GAN[i % 10]}${DI_ZHI[i % 12]}`);
  }
  return result;
})();

function getDaYunTenGods(ganZhi: string, dayStem: string): { tenGod: string; branchTenGod: string; } {
  const stem = ganZhi.slice(0, 1);
  const branch = ganZhi.slice(1, 2);
  const tenGod = stem ? calculateTenGod(dayStem, stem) : '';
  const branchMainStem = HIDDEN_STEM_MAIN[branch];
  const branchTenGod = branchMainStem ? calculateTenGod(dayStem, branchMainStem) : '';
  return { tenGod, branchTenGod };
}

/**
 * 计算一个地支与一组地支之间的所有关系
 */
export function calculateBranchRelations(targetBranch: string, natalBranches: string[], natalLabels: string[]): BranchRelation[] {
  const relations: BranchRelation[] = [];

  // 六合
  for (let i = 0; i < natalBranches.length; i++) {
    if (LIU_HE[targetBranch] === natalBranches[i]) {
      relations.push({
        type: '六合',
        branches: [targetBranch, natalBranches[i]],
        description: `${targetBranch}${natalBranches[i]}六合（与${natalLabels[i]}）`,
      });
    }
  }

  // 六冲
  for (let i = 0; i < natalBranches.length; i++) {
    if (LIU_CHONG[targetBranch] === natalBranches[i]) {
      relations.push({
        type: '六冲',
        branches: [targetBranch, natalBranches[i]],
        description: `${targetBranch}${natalBranches[i]}相冲（与${natalLabels[i]}）`,
      });
    }
  }

  // 三合：检查 targetBranch + 任意2个natal branches是否构成三合
  for (const sanHe of SAN_HE) {
    if (!sanHe.branches.includes(targetBranch)) continue;
    const matchingNatal = natalBranches.filter(b => sanHe.branches.includes(b) && b !== targetBranch);
    const uniqueMatching = [...new Set(matchingNatal)];
    if (uniqueMatching.length >= 2) {
      const involvedLabels = natalBranches
        .map((b, i) => (sanHe.branches.includes(b) && b !== targetBranch) ? natalLabels[i] : null)
        .filter(Boolean);
      relations.push({
        type: '三合',
        branches: [targetBranch, ...uniqueMatching],
        description: `${targetBranch}${uniqueMatching.join('')}三合${sanHe.element}（与${involvedLabels.join('、')}）`,
      });
    }
  }

  // 相刑
  for (const xing of XIANG_XING) {
    if (!xing.combination.includes(targetBranch)) continue;

    if (xing.combination.length === 1) {
      // 自刑：需要natal中也有同一地支
      const matching = natalBranches.filter(b => b === targetBranch);
      if (matching.length > 0) {
        const matchingLabels = natalBranches
          .map((b, i) => b === targetBranch ? natalLabels[i] : null)
          .filter(Boolean);
        relations.push({
          type: '相刑',
          branches: [targetBranch],
          description: `${xing.name}（与${matchingLabels.join('、')}）`,
        });
      }
    } else {
      // 多支刑：target + natal中的其他支
      const needed = xing.combination.filter(b => b !== targetBranch);
      const found = needed.filter(b => natalBranches.includes(b));
      if (found.length > 0) {
        const matchingLabels = natalBranches
          .map((b, i) => needed.includes(b) ? natalLabels[i] : null)
          .filter(Boolean);
        relations.push({
          type: '相刑',
          branches: [targetBranch, ...found],
          description: `${xing.name}（与${matchingLabels.join('、')}）`,
        });
      }
    }
  }

  // 相害
  for (let i = 0; i < natalBranches.length; i++) {
    if (XIANG_HAI[targetBranch] === natalBranches[i]) {
      relations.push({
        type: '相害',
        branches: [targetBranch, natalBranches[i]],
        description: `${targetBranch}${natalBranches[i]}相害（与${natalLabels[i]}）`,
      });
    }
  }

  return relations;
}

/**
 * 计算太岁关系（流年地支 vs 年柱地支）
 */
export function calculateTaiSui(liunianBranch: string, yearBranch: string): string[] {
  const result: string[] = [];

  // 值太岁
  if (liunianBranch === yearBranch) {
    result.push('值太岁');
  }

  // 冲太岁
  if (LIU_CHONG[liunianBranch] === yearBranch) {
    result.push('冲太岁');
  }

  // 合太岁
  if (LIU_HE[liunianBranch] === yearBranch) {
    result.push('合太岁');
  }

  // 刑太岁
  for (const xing of XIANG_XING) {
    if (xing.combination.includes(liunianBranch) && xing.combination.includes(yearBranch)
      && (liunianBranch !== yearBranch || xing.combination.length === 1)) {
      result.push('刑太岁');
      break;
    }
  }

  // 害太岁
  if (XIANG_HAI[liunianBranch] === yearBranch) {
    result.push('害太岁');
  }

  // 破太岁
  if (XIANG_PO[liunianBranch] === yearBranch) {
    result.push('破太岁');
  }

  return result;
}

/**
 * 根据公历年份获取干支
 */
function getYearGanZhi(year: number): string {
  // 以1984年甲子年为基准
  const offset = ((year - 1984) % 60 + 60) % 60;
  return JIA_ZI_60[offset];
}

/**
 * 计算小运
 */
function calculateXiaoYun(
  hourStem: string,
  hourBranch: string,
  gender: 'male' | 'female',
  yearStem: string,
  dayStem: string,
  startAge: number,
): XiaoyunInfo[] {
  if (startAge <= 1) return [];

  const hourGanZhi = `${hourStem}${hourBranch}`;
  const jiaZiIdx = JIA_ZI_60.indexOf(hourGanZhi);
  if (jiaZiIdx < 0) return [];

  // 阳男阴女顺排，阴男阳女逆排
  const yearIsYang = getStemYinYang(yearStem) === 'yang';
  const isMale = gender === 'male';
  const forward = (yearIsYang && isMale) || (!yearIsYang && !isMale);

  const xiaoYun: XiaoyunInfo[] = [];
  for (let age = 1; age < startAge; age++) {
    let idx: number;
    if (forward) {
      idx = (jiaZiIdx + age) % 60;
    } else {
      idx = (jiaZiIdx - age + 600) % 60;
    }
    const ganZhi = JIA_ZI_60[idx];
    const stem = ganZhi[0];
    xiaoYun.push({
      age,
      ganZhi,
      tenGod: calculateTenGod(dayStem, stem),
    });
  }

  return xiaoYun;
}

export function calculateDayunData(input: DayunInput): DayunOutput {
  const { gender } = input;
  const yunSect = input.yunSect ?? 1;
  if (yunSect !== 1 && yunSect !== 2) throw new CoreInputError('yunSect', '起运算法必须为 1 或 2');
  const { lunar, termLunar, trueSolarTimeInfo } = resolveBaziCalendarContext(input);
  const eightChar = lunar.getEightChar();
  eightChar.setSect(input.dayBoundary === 'zi' ? 1 : 2);
  const termEightChar = termLunar.getEightChar();
  termEightChar.setSect(input.dayBoundary === 'zi' ? 1 : 2);
  const dayStem = eightChar.getDayGan();
  const yearStem = termEightChar.getYearGan();
  const yearBranch = termEightChar.getYearZhi();
  const monthBranch = termEightChar.getMonthZhi();
  const dayBranch = eightChar.getDayZhi();
  const hourStem = eightChar.getTimeGan();
  const hourBranch = eightChar.getTimeZhi();

  // 原局四柱地支
  const natalBranches = [yearBranch, monthBranch, dayBranch, hourBranch];
  const natalLabels = ['年柱', '月柱', '日柱', '时柱'];

  // 构建神煞上下文（基于原命盘四柱）
  const shenShaContext: ShenShaContext = {
    yearStem,
    yearBranch,
    monthStem: termEightChar.getMonthGan(),
    monthBranch,
    dayStem,
    dayBranch,
    hourStem,
    hourBranch,
  };

  const genderNum = gender === 'male' ? 1 : 0;
  const yun = termEightChar.getYun(genderNum, yunSect);
  const daYunList = yun.getDaYun().filter((dy) => dy.getGanZhi()).slice(0, 10);

  const list = daYunList
    .map((dy) => {
      const ganZhi = dy.getGanZhi();
      const stem = ganZhi.slice(0, 1);
      const branch = ganZhi.slice(1, 2);
      const { tenGod, branchTenGod } = getDaYunTenGods(ganZhi, dayStem);
      const startYear = dy.getStartYear();

      // 大运地支与原局四柱地支的关系
      const branchRelations = calculateBranchRelations(branch, natalBranches, natalLabels);

      // 流年计算：该大运10年内的每一年
      const liunianList: LiunianInfo[] = [];
      for (let i = 0; i < 10; i++) {
        const lnYear = startYear + i;
        const lnGanZhi = getYearGanZhi(lnYear);
        const lnStem = lnGanZhi[0];
        const lnBranch = lnGanZhi[1];

        // 流年十神（相对日主）
        const lnTenGod = calculateTenGod(dayStem, lnStem);

        // 流年纳音
        const lnNayin = NA_YIN_TABLE[lnGanZhi] || '';

        // 流年地支与原局四柱地支关系
        const lnNatalRelations = calculateBranchRelations(lnBranch, natalBranches, natalLabels);

        // 流年地支与当前大运地支关系
        const lnDayunRelations = calculateBranchRelations(lnBranch, [branch], ['大运']);

        // 合并关系
        const lnBranchRelations = [...lnNatalRelations, ...lnDayunRelations];

        // 太岁关系
        const taiSui = calculateTaiSui(lnBranch, yearBranch);

        liunianList.push({
          year: lnYear,
          age: dy.getStartAge() + i,
          ganZhi: lnGanZhi,
          gan: lnStem,
          zhi: lnBranch,
          tenGod: lnTenGod,
          nayin: lnNayin,
          hiddenStems: buildHiddenStems(lnBranch, dayStem),
          diShi: getDiShi(dayStem, lnBranch),
          shenSha: calculateBranchShenSha(shenShaContext, lnBranch),
          branchRelations: lnBranchRelations,
          taiSui,
        });
      }

      return {
        startYear,
        startAge: dy.getStartAge(),
        ganZhi,
        stem,
        branch,
        tenGod,
        branchTenGod,
        hiddenStems: buildHiddenStems(branch, dayStem),
        naYin: getNaYin(stem, branch),
        diShi: getDiShi(dayStem, branch),
        shenSha: calculateBranchShenSha(shenShaContext, branch),
        branchRelations,
        liunianList,
      };
    });

  // 小运计算
  const firstDaYunStartAge = daYunList.length > 0 ? daYunList[0].getStartAge() : 1;
  const xiaoYun = calculateXiaoYun(hourStem, hourBranch, gender, yearStem, dayStem, firstDaYunStartAge);
  const startAge = daYunList.length > 0 ? daYunList[0].getStartAge() : yun.getStartYear();
  const startAgeDetail = `${yun.getStartYear()}年${yun.getStartMonth()}月${yun.getStartDay()}天${yun.getStartHour() ? `${yun.getStartHour()}小时` : ''}起运`;
  return { startAge, startAgeDetail, xiaoYun, list,
    startSolar: yun.getStartSolar().toYmdHms(), direction: yun.isForward() ? 'forward' : 'backward',
    yunSect, dayBoundary: input.dayBoundary ?? 'midnight', trueSolarTimeInfo,
    calculationOptions: { timezone: input.timezone ?? DEFAULT_DIVINATION_TIMEZONE, startSolarTimezone: CALENDAR_TIMEZONE, ...(input.longitude === undefined ? {} : { longitude: input.longitude }), yunSect, dayBoundary: input.dayBoundary ?? 'midnight', disambiguation: input.disambiguation ?? 'reject', ageConvention: 'nominal', ruleVersion: 'bazi-dayun-2026.10' } };
}
