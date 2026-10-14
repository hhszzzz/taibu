import { withRulesJSON } from '../../shared/calculation-rules.js';
import type {
  QimenCanonicalJSON
} from './json-types.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  QimenOutput
} from './types.js';
import type {
  QimenCanonicalTextOptions
} from '../shared/text-options.js';

function buildQimenPalaceStatusList(palace: QimenOutput['palaces'][number], dayKongPalaces: Set<number>, hourKongPalaces: Set<number>, panType: QimenOutput['panType']): string[] {
  if (palace.palaceIndex === 5 && panType !== 'fei' && panType !== '飞盘') return ['寄宫参看对应宫位'];
  return [
    dayKongPalaces.has(palace.palaceIndex) ? '日空' : null,
    hourKongPalaces.has(palace.palaceIndex) ? '时空' : null,
    palace.isYiMa ? '驿马' : null,
    palace.isRuMu ? formatQimenRuMuStatus(palace) : null,
    palace.isMenPo ? '门迫' : null,
    palace.isJiXing ? '六仪击刑' : null,
  ].filter((value): value is string => !!value);
}

/** 入墓注明入墓之干；旧版结果没有 ruMuStems 时只写“入墓” */
export function formatQimenRuMuStatus(palace: QimenOutput['palaces'][number]): string {
  return palace.ruMuStems?.length ? `入墓(${palace.ruMuStems.join('、')})` : '入墓';
}

function buildQimenPalaceRef(result: QimenOutput, index: number): string {
  const palace = result.palaces[index - 1];
  return palace ? `${palace.palaceName}${index}` : String(index);
}

export const renderQimenCanonicalJSON = withRulesJSON(renderQimenCanonicalJSONBase);

function renderQimenCanonicalJSONBase(result: QimenOutput, options: { detailLevel?: QimenCanonicalTextOptions['detailLevel']; } = {}): QimenCanonicalJSON {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const dunText = result.dunType === 'yang' ? '阳遁' : '阴遁';
  const basicInfo: QimenCanonicalJSON['基本信息'] = {
    四柱: `${result.siZhu.year} ${result.siZhu.month} ${result.siZhu.day} ${result.siZhu.hour}`,
    节气: result.dateInfo.solarTerm,
    局式: `${dunText}${result.juNumber}局`,
    三元: result.yuan,
    旬首: result.xunShou,
    值符: result.zhiFu.star,
    值使: result.zhiShi.gate,
  };
  if (result.question) basicInfo.占问 = result.question;
  if (detailLevel === 'full') {
    basicInfo.公历 = result.dateInfo.solarDate;
    basicInfo.农历 = result.dateInfo.lunarDate;
    if (result.dateInfo.solarTermRange) basicInfo.节气范围 = result.dateInfo.solarTermRange;
    basicInfo.盘式 = result.panType;
    basicInfo.定局法 = result.juMethod;
  }

  const dayKongPalaces = new Set(result.kongWang.dayKong.palaces);
  const hourKongPalaces = new Set(result.kongWang.hourKong.palaces);

  const palaces = result.palaces.map((palace) => {
    const item: QimenCanonicalJSON['九宫盘'][number] = {
      宫名: palace.palaceName,
      宫位序号: palace.palaceIndex,
      宫位: `${palace.palaceName}${palace.palaceIndex}`,
      宫位五行: palace.element || '-',
      八神: palace.deity || '-',
      九星: palace.star || '-',
      ...(palace.starElement ? { 九星五行: palace.starElement } : {}),
      八门: palace.gate || '-',
      ...(palace.gateElement ? { 八门五行: palace.gateElement } : {}),
      天盘天干: palace.heavenStem || '-',
      地盘天干: palace.earthStem || '-',
      ...(palace.hostedStars?.length ? { 寄星: [...palace.hostedStars] } : {}),
      ...(palace.hostedHeavenStems?.length ? { 寄天盘干: [...palace.hostedHeavenStems] } : {}),
      ...(palace.hostedEarthStems?.length ? { 寄地盘干: [...palace.hostedEarthStems] } : {}),
      宫位状态: buildQimenPalaceStatusList(palace, dayKongPalaces, hourKongPalaces, result.panType),
    };
    if (detailLevel === 'full') {
      item.方位 = palace.direction || '-';
      if (palace.formations.length > 0) item.格局 = [...palace.formations];
      if (palace.elementState) item.宫旺衰 = palace.elementState;
      if (palace.heavenStemElement) item.天盘天干五行 = palace.heavenStemElement;
      if (palace.earthStemElement) item.地盘天干五行 = palace.earthStemElement;
    }
    return item;
  });

  const json: QimenCanonicalJSON = {
    基本信息: basicInfo,
    九宫盘: palaces,
  };
  if (detailLevel === 'full') {
    json.空亡信息 = {
      日空: {
        地支: [...result.kongWang.dayKong.branches],
        宫位: result.kongWang.dayKong.palaces.map((index) => buildQimenPalaceRef(result, index)),
      },
      时空: {
        地支: [...result.kongWang.hourKong.branches],
        宫位: result.kongWang.hourKong.palaces.map((index) => buildQimenPalaceRef(result, index)),
      },
    };
    if (result.yiMa.branch && result.yiMa.palace) {
      json.驿马 = {
        地支: result.yiMa.branch,
        宫位: buildQimenPalaceRef(result, result.yiMa.palace),
      };
    }
    if (result.monthPhase && Object.keys(result.monthPhase).length > 0) {
      json.十干月令旺衰 = { ...result.monthPhase };
    }
  }
  // 格局是断盘主要依据，默认档也输出；全盘格局只列一次，不在九宫里逐宫重复
  if (result.globalFormations.length > 0) {
    json.全局格局 = [...result.globalFormations];
  }

  return json;
}

// ===== 大六壬 =====
