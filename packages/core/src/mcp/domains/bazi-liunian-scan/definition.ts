import type { ToolInputSchema } from '../../contract.js';
import { BAZI_LIUNIAN_SCAN_PILLARS } from '../../../domains/bazi/liunian-scan.js';
import { GANZHI_RELATION_TYPES } from '../../../domains/shared/ganzhi-relations.js';

export const BAZI_LIUNIAN_SCAN_DESCRIPTION = '八字流年扫描 - 在八字命盘上逐年列出一段年份（最多 30 年）的流年干支、所在大运（起运前为小运）、十神，流年与原局、与大运的刑冲合害，以及太岁与岁运提示。找「哪些年冲日柱」这类问题时用 pillars、types 筛选，只列命中的年份，同一字上的其他流年关系标为牵连，其余只给「未列出」条数；某一年的完整关系（含大运与原局之间）用 bazi_relations。只给事实，不下吉凶结论。';

export const baziLiunianScanSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    fromYear: { type: 'integer', minimum: 1, maximum: 9998, description: '起始流年（公历年份，不早于出生年）' },
    toYear: { type: 'integer', minimum: 1, maximum: 9998, description: '结束流年（含），与起始年合计不超过 30 年' },
    pillars: {
      type: 'array', minItems: 1, maxItems: BAZI_LIUNIAN_SCAN_PILLARS.length,
      items: { type: 'string', enum: [...BAZI_LIUNIAN_SCAN_PILLARS] },
      description: '只看流年同时涉及这些柱位的关系，如 ["日柱"]；「大运」在起运前指小运',
    },
    types: {
      type: 'array', minItems: 1, maxItems: GANZHI_RELATION_TYPES.length,
      items: { type: 'string', enum: [...GANZHI_RELATION_TYPES] },
      description: '只看这些类型的关系，如 ["六冲"]；只列出有该类关系的年份',
    },
    yunSect: { type: 'integer', enum: [1, 2], default: 1, description: '起运换算法1或2（与 bazi_dayun 一致）' },
  },
  required: ['fromYear', 'toYear'],
  examples: [
    { fromYear: 2024, toYear: 2033 },
    { fromYear: 2026, toYear: 2035, pillars: ['日柱'] },
    { fromYear: 2024, toYear: 2053, types: ['六冲'] },
  ],
};
