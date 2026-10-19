import { withRulesJSON } from '../../shared/calculation-rules.js';
import type { DaliurenOutput } from './types.js';
import type {
  DaliurenCanonicalJSON
} from './json-types.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  DaliurenCanonicalTextOptions
} from '../shared/text-options.js';

/** 课别、传序标签：规范 JSON 与详查工具的位置共用 */
export const DALIUREN_LESSON_LABELS = ['一课 (干上)', '二课 (干阴)', '三课 (支上)', '四课 (支阴)'] as const;
export const DALIUREN_TRANSMISSION_LABELS = ['初传 (发端)', '中传 (移易)', '末传 (归计)'] as const;

export const renderDaliurenCanonicalJSON = withRulesJSON(renderDaliurenCanonicalJSONBase);

function renderDaliurenCanonicalJSONBase(result: DaliurenOutput, options: { detailLevel?: DaliurenCanonicalTextOptions['detailLevel']; } = {}): DaliurenCanonicalJSON {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const basicInfo: DaliurenCanonicalJSON['基本信息'] = {
    占测时间: result.dateInfo.solarDate,
    昼夜: result.dateInfo.diurnal ? '昼占' : '夜占',
    四柱: result.dateInfo.bazi,
    课式: `${result.keName} / ${result.keTi.method}课`,
    月将: result.dateInfo.yueJiang,
    关键状态: {
      空亡: [...result.dateInfo.kongWang],
      驿马: result.dateInfo.yiMa,
      丁马: result.dateInfo.dingMa,
      天马: result.dateInfo.tianMa,
    },
  };
  if (result.question) basicInfo.占事 = result.question;
  if (detailLevel === 'full') {
    if (result.dateInfo.lunarDate) basicInfo.农历 = result.dateInfo.lunarDate;
    basicInfo.月将名称 = result.dateInfo.yueJiangName;
    if (result.benMing) basicInfo.本命 = result.benMing;
    if (result.xingNian) basicInfo.行年 = result.xingNian;
    if (result.keTi.extraTypes.length > 0) basicInfo.附加课体 = [...result.keTi.extraTypes];
    if (result.keTi.subTypes.length > 0) basicInfo.细分课体 = [...result.keTi.subTypes];
  }

  const keLabels = DALIUREN_LESSON_LABELS;
  const keData = [result.siKe.yiKe, result.siKe.erKe, result.siKe.sanKe, result.siKe.siKe];
  const siKe = keLabels.map((label, i) => ({
    课别: label,
    乘将: keData[i][1] || '-',
    上神: keData[i][0]?.[0] || '-',
    下神: keData[i][0]?.[1] || '-',
  }));

  const chuanLabels = DALIUREN_TRANSMISSION_LABELS;
  const chuanData = [result.sanChuan.chu, result.sanChuan.zhong, result.sanChuan.mo];
  const sanChuan = chuanLabels.map((label, i) => ({
    传序: label,
    地支: chuanData[i][0] || '-',
    天将: chuanData[i][1] || '-',
    六亲: chuanData[i][2] || '-',
    遁干: chuanData[i][3] || '-',
  }));

  const gongInfos = result.gongInfos.map((item: DaliurenOutput['gongInfos'][number]) => ({
    地盘: item.diZhi,
    ...(item.wuXing ? { 五行: item.wuXing } : {}),
    ...(item.wangShuai ? { 旺衰: item.wangShuai } : {}),
    天盘: item.tianZhi,
    天将: item.tianJiang,
    遁干: item.dunGan || '-',
    长生十二神: item.changSheng || '-',
    ...(detailLevel === 'full' ? { 建除: item.jianChu || '-' } : {}),
  }));

  return {
    基本信息: basicInfo,
    四课: siKe,
    三传: sanChuan,
    天地盘: gongInfos,
    ...(detailLevel === 'full' ? { 神煞: result.shenSha.map(item => ({ 名称: item.name, 落点: item.value, ...(item.description ? { 说明: item.description } : {}) })) } : {}),
  };
}

// ===== 每日运势 =====
