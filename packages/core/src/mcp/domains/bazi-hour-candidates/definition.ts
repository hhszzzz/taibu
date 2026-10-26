import type { ToolDefinition } from '../../contract.js';
import { BAZI_HOUR_EVENT_YEARS_MAX } from '../../../domains/bazi/hour-candidates.js';
import { baziCalculateDefinition } from '../bazi/definition.js';

/** 与 bazi 相同的出生日期与排盘口径；出生时间正是要推的，夏令时由各候选自己给出 */
const BIRTH_FIELDS = ['gender', 'birthYear', 'birthMonth', 'birthDay', 'calendarType', 'isLeapMonth', 'birthPlace', 'timezone', 'dayBoundary', 'longitude'];
const birth = Object.fromEntries(BIRTH_FIELDS.map((key) => [key, baziCalculateDefinition.inputSchema.properties[key]]));

export const BAZI_HOUR_CANDIDATES_DESCRIPTION = '推算出生时辰 - 出生时辰未知时，列出出生当天各时辰的候选：四柱、时柱十神与藏干、时柱与原局的干支关系、命宫、日主在时支的根、月令透时干、缺失五行与起运；给了前事年份时，再逐个候选列出这些年的流年、大运与时柱的关系。只列事实，不判断哪个时辰更可能：向用户核对六亲与前事、由用户确认后，用该候选的 birthHour、birthMinute 正式排盘。';

export const baziHourCandidatesDefinition: ToolDefinition = {
  name: 'bazi_hour_candidates',
  description: BAZI_HOUR_CANDIDATES_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      ...birth,
      fromHour: {
        type: 'integer', minimum: 0, maximum: 23,
        description: '只列与钟表时段 [fromHour, toHour) 相交的候选；用户记得大致时段时用（如上午传 5 与 12），默认全天',
      },
      toHour: {
        type: 'integer', minimum: 1, maximum: 24,
        description: '时段结束的钟点（不含），须晚于 fromHour，默认 24',
      },
      eventYears: {
        type: 'array', minItems: 1, maxItems: BAZI_HOUR_EVENT_YEARS_MAX,
        items: { type: 'integer', minimum: 1, maximum: 9998 },
        description: `用户确认过的前事年份（公历，如结婚、生子、升学、搬迁、亲人离世之年），最多 ${BAZI_HOUR_EVENT_YEARS_MAX} 个：逐个候选列出这些年流年、大运与时柱的关系`,
      },
      detailLevel: {
        type: 'string', enum: ['default', 'full'], default: 'default',
        description: '文本详略：default=各候选的区分事实；full=另附时柱神煞与判定口径（结构化结果始终带神煞与口径）',
      },
    },
    required: ['gender', 'birthYear', 'birthMonth', 'birthDay'],
    examples: [
      { gender: 'female', birthYear: 1995, birthMonth: 1, birthDay: 9 },
      { gender: 'male', birthYear: 1990, birthMonth: 5, birthDay: 20, fromHour: 5, toHour: 12, eventYears: [2015, 2018] },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
