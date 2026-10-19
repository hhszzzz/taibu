import type { ToolInputSchema } from '../../contract.js';

export const BAZI_WUXING_DESCRIPTION = '八字五行流通 - 在八字命盘上详查五行：天干、地支本气与藏干加权统计，月令旺相休囚死，日主通根与透干，干支自坐与相邻天干生克，相生链的连续与中断，以及十神分布。只给事实，不判断身强身弱或喜用神。';

export const baziWuxingSelector: ToolInputSchema = {
  type: 'object',
  properties: {},
  examples: [{}],
};
