import type { ToolInputSchema } from '../../contract.js';

export const BAZI_RELATIONS_DESCRIPTION = '八字刑冲合害 - 在八字命盘上详查干支关系：原局四柱之间，以及叠加大运（起运前为小运）、流年、流月、流日后的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，附岁运并临、伏吟、天克地冲与太岁关系。只给事实，不下吉凶结论。';

export const baziRelationsSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    year: { type: 'integer', minimum: 1, maximum: 9998, description: '流年（公历年份）；给出后自动叠加所在大运' },
    month: { type: 'integer', minimum: 1, maximum: 12, description: '流月：节气月序号 1–12（1=寅月，自立春起；12=丑月，自小寒起），须同时给出 year' },
    day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '流日 YYYY-MM-DD，与 year/month 互斥；自动叠加当日的流年、流月与所在大运' },
    dayun: { type: 'integer', minimum: 1, maximum: 10, description: '大运序号 1–10；省略时按流年自动选取' },
    yunSect: { type: 'integer', enum: [1, 2], default: 1, description: '起运换算法1或2（与 bazi_dayun 一致）' },
  },
  allOf: [
    { if: { required: ['month'] }, then: { required: ['year'] } },
    { not: { required: ['day', 'year'] } },
    { not: { required: ['day', 'month'] } },
  ],
  examples: [
    {},
    { year: 2027 },
    { year: 2027, month: 5 },
    { day: '2027-06-10' },
  ],
};
