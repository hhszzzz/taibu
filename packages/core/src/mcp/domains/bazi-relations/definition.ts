import type { ToolInputSchema } from '../../contract.js';
import { BAZI_RELATION_PILLARS } from '../../../domains/bazi/relations.js';
import { GANZHI_RELATION_TYPES } from '../../../domains/shared/ganzhi-relations.js';

export const BAZI_RELATIONS_DESCRIPTION = '八字岁运刑冲合害 - 在八字命盘上叠加大运（起运前为小运）、流年、流月或流日，详查它们与原局四柱、与彼此之间的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，附岁运并临、伏吟、天克地冲与太岁关系。原局四柱之间的关系已在八字命盘的「干支关系」中列出，这里不再重复，所以须给出 year、day 或 dayun。只问某柱或某类关系时用 pillars（同时涉及所列各柱）或 types 筛选：与所列关系共用同一字的其他叠加关系照列为「同字牵连」（同一字上合冲刑并见须一并看），其余只给「未列出」条数。不计拱合、暗合、半会；天克地冲取天干相冲且地支六冲，伏吟取干支全同；流年按公历年份取干支。只给事实，不下吉凶结论。';

export const baziRelationsSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    year: { type: 'integer', minimum: 1, maximum: 9998, description: '流年（公历年份）；给出后自动叠加所在大运' },
    month: { type: 'integer', minimum: 1, maximum: 12, description: '流月：节气月序号 1–12（1=寅月，自立春起；12=丑月，自小寒起），须同时给出 year' },
    day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '流日 YYYY-MM-DD，与 year/month 互斥；自动叠加当日的流年、流月与所在大运' },
    dayun: { type: 'integer', minimum: 1, maximum: 10, description: '大运序号 1–10；省略时按流年自动选取' },
    yunSect: { type: 'integer', enum: [1, 2], default: 1, description: '起运换算法1或2（与 bazi_dayun 一致）' },
    pillars: {
      type: 'array', minItems: 1, maxItems: BAZI_RELATION_PILLARS.length,
      items: { type: 'string', enum: [...BAZI_RELATION_PILLARS] },
      description: '只列同时涉及这些柱位的叠加关系：["日柱"] 看日柱与各叠加柱的关系，["日柱","流年"] 只看日柱与流年之间；「大运」在起运前指小运；叠加柱须有对应的 year、month、day 或 dayun',
    },
    types: {
      type: 'array', minItems: 1, maxItems: GANZHI_RELATION_TYPES.length,
      items: { type: 'string', enum: [...GANZHI_RELATION_TYPES] },
      description: '只列这些类型的关系，如 ["六冲","相刑"]；岁运提示与太岁关系不按类型筛',
    },
  },
  anyOf: [{ required: ['year'] }, { required: ['day'] }, { required: ['dayun'] }],
  allOf: [
    { if: { required: ['month'] }, then: { required: ['year'] } },
    { not: { required: ['day', 'year'] } },
    { not: { required: ['day', 'month'] } },
  ],
  examples: [
    { year: 2027 },
    { dayun: 3 },
    { year: 2027, month: 5 },
    { day: '2027-06-10' },
    { year: 2027, pillars: ['日柱'] },
    { year: 2027, types: ['六冲', '相刑'] },
  ],
};
