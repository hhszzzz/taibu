import type { ToolInputSchema } from '../../contract.js';
import { BAZI_WUXING_SECTIONS } from '../../../domains/bazi/wuxing.js';

export const BAZI_WUXING_DESCRIPTION = '八字五行旺衰 - 在八字命盘上详查旺衰与生克的事实：月令旺相休囚死与日主得失，月令各藏干透出与否（取格看月令），四个天干各自的通根（本气、中气、余气，无根亦列出），干支自坐与相邻天干的生克，以及缺失五行。日主、月令与缺失五行总在，其余事实组可用 sections 只取所需。旺衰不是五行字数相加，本工具只给这些因子，不判身强身弱、格局或喜用。辰戌丑未月以土论。';

export const baziWuxingSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'array', minItems: 1, maxItems: BAZI_WUXING_SECTIONS.length,
      items: { type: 'string', enum: [...BAZI_WUXING_SECTIONS] },
      description: '只取这些事实组，如 ["通根"]；省略时全部给出（日主、月令与缺失五行总在）',
    },
  },
  examples: [{}, { sections: ['通根'] }],
};
