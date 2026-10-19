import type { ToolInputSchema } from '../../contract.js';
import { BAZI_LIUNIAN_SCAN_FOCUS } from '../../../domains/bazi/liunian-scan.js';

export const BAZI_LIUNIAN_SCAN_DESCRIPTION = '八字流年扫描 - 在八字命盘上逐年列出一段年份（最多 30 年）的流年干支、所在大运（起运前为小运）、十神，流年与原局、与大运的刑冲合害，以及太岁与岁运提示；可按柱位或关系类型筛选。只给事实，不下吉凶结论。';

export const baziLiunianScanSelector: ToolInputSchema = {
  type: 'object',
  properties: {
    fromYear: { type: 'integer', minimum: 1, maximum: 9998, description: '起始流年（公历年份，不早于出生年）' },
    toYear: { type: 'integer', minimum: 1, maximum: 9998, description: '结束流年（含），与起始年合计不超过 30 年' },
    focus: {
      type: 'string', enum: [...BAZI_LIUNIAN_SCAN_FOCUS],
      description: '只看涉及该柱位（年柱/月柱/日柱/时柱/大运）或该关系类型（如 六冲、相刑）的年份',
    },
    yunSect: { type: 'integer', enum: [1, 2], default: 1, description: '起运换算法1或2（与 bazi_dayun 一致）' },
  },
  required: ['fromYear', 'toYear'],
  examples: [
    { fromYear: 2024, toYear: 2033 },
    { fromYear: 2026, toYear: 2035, focus: '日柱' },
  ],
};
