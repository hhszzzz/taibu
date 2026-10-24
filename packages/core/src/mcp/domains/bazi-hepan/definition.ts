import type { ToolDefinition, ToolSchema } from '../../contract.js';
import { BAZI_HEPAN_DEFAULT_NAMES } from '../../../domains/bazi/hepan.js';
import { baziCalculateDefinition } from '../bazi/definition.js';

export const BAZI_HEPAN_DESCRIPTION = '八字合盘 - 两人各排四柱，列出两盘之间的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，日主互见的十神与五行生克，日柱（日主与夫妻宫）、年柱（生肖与年命纳音）之间的关系，以及一方所缺、另一方原局有的五行。问两人合不合、婚配、合作或亲子相处时使用；各自盘内的关系见各自的八字命盘。只给事实，不打分、不下吉凶结论。';

/** bazi 的出生参数；详略是整次合盘的，不属于某一方 */
const birth = Object.fromEntries(Object.entries(baziCalculateDefinition.inputSchema.properties).filter(([key]) => key !== 'detailLevel'));

/** 一方的出生信息：与 bazi 的参数相同，另加标在柱名前的称呼 */
function person(index: 0 | 1): ToolSchema {
  return {
    type: 'object',
    additionalProperties: false,
    description: `${BAZI_HEPAN_DEFAULT_NAMES[index]}的出生信息，参数与 bazi 相同`,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 12, description: `称呼（如「我」「对方」或名字，不含空白、「·」或「｜」），标在柱名前；省略时为「${BAZI_HEPAN_DEFAULT_NAMES[index]}」，两人不能相同` },
      ...birth,
    },
    required: [...(baziCalculateDefinition.inputSchema.required ?? [])],
  };
}

export const baziHepanDefinition: ToolDefinition = {
  name: 'bazi_hepan',
  description: BAZI_HEPAN_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      a: person(0),
      b: person(1),
      detailLevel: {
        type: 'string', enum: ['default', 'full'], default: 'default',
        description: '文本详略：default=双方要点与两盘之间的事实；full=另附四柱纳音与判定口径（结构化结果始终带口径）',
      },
    },
    required: ['a', 'b'],
    examples: [
      {
        a: { name: '男方', gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 },
        b: { name: '女方', gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14 },
      },
      {
        a: { gender: 'female', birthYear: 1995, birthMonth: 6, birthDay: 20, birthHour: 23, calendarType: 'lunar' },
        b: { gender: 'male', birthYear: 1993, birthMonth: 11, birthDay: 2, birthHour: 7, birthMinute: 30 },
      },
    ],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
