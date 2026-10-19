import type { ToolInputSchema } from '../../contract.js';

export const QIMEN_PALACE_DESCRIPTION = '奇门宫位详查 - 在奇门盘上详查一宫：指定宫位，或按年月日时干（取天盘，甲取所遁六仪）、九星、八门、八神定位；列出天地盘干与寄干、星门神、空亡马星入墓击刑门迫、旺衰、门宫星宫干宫生克、值符值使与本宫格局。只给事实，不下吉凶结论。';

export const qimenPalaceSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    palace: { type: 'integer', minimum: 1, maximum: 9, description: '宫位序号 1–9（坎1 坤2 震3 巽4 中5 乾6 兑7 艮8 离9），与 locate 二选一' },
    locate: {
      type: 'object',
      description: '按柱干或星门神定位，与 palace 二选一',
      properties: {
        type: { type: 'string', enum: ['年干', '月干', '日干', '时干', '星', '门', '神'], description: '定位依据' },
        value: { type: 'string', minLength: 1, maxLength: 8, description: '星、门、神的名称（如 天心、开门、值符）；按柱干定位时不填' },
      },
      required: ['type'],
      additionalProperties: false,
      allOf: [
        { if: { properties: { type: { enum: ['星', '门', '神'] } } }, then: { required: ['value'] } },
        { if: { properties: { type: { enum: ['年干', '月干', '日干', '时干'] } } }, then: { not: { required: ['value'] } } },
      ],
    },
  },
  oneOf: [{ required: ['palace'] }, { required: ['locate'] }],
  examples: [
    { palace: 1 },
    { locate: { type: '日干' } },
    { locate: { type: '门', value: '开门' } },
  ],
};
